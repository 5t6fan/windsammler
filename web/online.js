'use strict';
/* Online-Teil: Spielerprofil, Gruppen mit Einladungscode, Ranglisten (Gruppe/global, Monat/Jahr/Gesamt),
 * Bewertungen zu Anlagen (Supabase).
 * Ohne Eintrag in config.js bleibt die App rein lokal und der Rangliste-Tab ist ausgeblendet.
 * Nutzt Hilfsfunktionen aus app.js ($, esc, toast, fmt0, datum).
 */
const Online = (() => {
  const cfg = window.WINDSAMMLER_CONFIG || {};
  const aktiv = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  const sb = aktiv ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  const WARTESCHLANGE = 'windsammler.warteschlange';
  const GRUPPE_GEWAEHLT = 'windsammler.gruppe';

  const GLOBAL = 'global';

  let profil = null;          // { id, name, global }
  let gruppen = [];
  let gruppe = null;          // gewählte Gruppen-ID oder GLOBAL
  let zeitraum = 'monat';     // monat | jahr | gesamt
  let versatz = 0;            // 0 = aktueller Monat/aktuelles Jahr, 1 = davor …
  const entdeckerCache = new Map();
  const kommentarCache = new Map();

  /* ---------- Hilfen ---------- */

  const lies = (k, standard) => { try { return JSON.parse(localStorage.getItem(k)) ?? standard; } catch (_) { return standard; } };
  const schreib = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* egal */ } };
  const netzfehler = (e) => !navigator.onLine || /fetch|network|load failed|timeout/i.test((e && e.message) || '');

  async function rpc(name, params) {
    const { data, error } = await sb.rpc(name, params);
    if (error) throw error;
    return data;
  }

  function fehlertext(e) {
    if (netzfehler(e)) return 'Keine Verbindung';
    if (e && e.code === '23505' && /profile_name/.test(e.message || '')) return 'Dieser Spielername ist schon vergeben';
    return (e && e.message) || 'Unbekannter Fehler';
  }

  /* ---------- Start & Konto ---------- */

  async function init() {
    if (!aktiv) return;
    $('#tab-rang').hidden = false;
    gruppe = lies(GRUPPE_GEWAEHLT, null);
    try {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        await ladeProfil(data.session.user.id);
        await ladeGruppen();
      }
    } catch (_) { /* offline – später erneut */ }
    render();
    sendeWarteschlange();
    window.addEventListener('online', sendeWarteschlange);
  }

  async function ladeProfil(uid) {
    const { data, error } = await sb.from('profile').select('id,name,global').eq('id', uid).maybeSingle();
    if (error) throw error;
    profil = data;
  }

  /* ---------- Captcha (Cloudflare Turnstile) gegen massenhaft angelegte Konten ----------
   * Wird erst geladen, wenn jemand die Anmeldeseite öffnet – wer die Rangliste nicht nutzt,
   * hat keinen Kontakt zu Cloudflare. Ohne turnstileSiteKey in config.js entfällt das Captcha. */
  let captchaToken = null;
  let captchaWidget = null;
  let captchaLaedt = null;

  function ladeCaptcha() {
    if (!cfg.turnstileSiteKey) return;
    if (!captchaLaedt) {
      captchaLaedt = new Promise((ok, fehler) => {
        window.windsammlerTurnstile = ok;
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=windsammlerTurnstile';
        s.async = true;
        s.onerror = fehler;
        document.head.appendChild(s);
      });
    }
    captchaLaedt.then(() => {
      if (captchaWidget !== null) return;
      captchaWidget = window.turnstile.render('#captcha', {
        sitekey: cfg.turnstileSiteKey,
        language: 'de',
        callback: (t) => { captchaToken = t; $('#btn-anmelden').disabled = false; },
        'expired-callback': () => { captchaToken = null; $('#btn-anmelden').disabled = true; },
        'error-callback': () => { captchaToken = null; $('#btn-anmelden').disabled = true; },
      });
    }).catch(() => toast('Sicherheitsprüfung nicht ladbar – Internetverbindung prüfen'));
  }

  function captchaZuruecksetzen() {
    captchaToken = null;
    if (captchaWidget !== null && window.turnstile) window.turnstile.reset(captchaWidget);
  }

  // Nach einem vergebenen Namen bleibt die Sitzung bestehen – dann ist kein neues Captcha nötig
  let hatSitzung = false;

  async function anmelden(name) {
    name = name.trim();
    if (name.length < 2) return toast('Bitte mindestens 2 Zeichen');
    try {
      let { data: { session } } = await sb.auth.getSession();
      if (!session) {
        if (cfg.turnstileSiteKey && !captchaToken) return toast('Bitte die Sicherheitsprüfung abwarten');
        const r = await sb.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
        captchaZuruecksetzen();
        if (r.error) throw r.error;
        session = r.data.session;
      }
      hatSitzung = true;
      const { error } = await sb.from('profile').upsert({ id: session.user.id, name });
      if (error) throw error;
      profil = { id: session.user.id, name, global: !!(profil && profil.global) };
      toast('Willkommen, ' + name + '!');
      await ladeGruppen();
    } catch (e) {
      toast('Anmeldung fehlgeschlagen: ' + fehlertext(e));
    }
    render();
  }

  async function umbenennen() {
    const name = (prompt('Neuer Spielername', profil.name) || '').trim();
    if (!name || name === profil.name) return;
    const { error } = await sb.from('profile').update({ name }).eq('id', profil.id);
    if (error) return toast('Ändern fehlgeschlagen: ' + fehlertext(error));
    profil.name = name;
    render();
  }

  async function kontoLoeschen() {
    if (!confirm('Konto, Punkte und Gruppenmitgliedschaften endgültig löschen? Dein lokales Sammelheft bleibt erhalten.')) return;
    try {
      await rpc('konto_loeschen');
      await sb.auth.signOut();
      profil = null; gruppen = []; gruppe = null;
      schreib(WARTESCHLANGE, []);
      toast('Konto gelöscht');
    } catch (e) {
      toast('Löschen fehlgeschlagen: ' + fehlertext(e));
    }
    render();
  }

  /* ---------- Sammeln ---------- */

  // Wird von app.js nach einem lokalen Fund aufgerufen.
  const sammeln = (id, lat, lon) => senden('sammeln', id, lat, lon);
  // Turm berührt (unter 20 m) – sammelt die Anlage mit, falls nötig
  const beruehren = (id, lat, lon) => senden('beruehren', id, lat, lon);

  async function senden(art, id, lat, lon) {
    if (!profil) return null;
    try {
      return await rpc(art, { p_anlage: id, p_lat: lat, p_lon: lon });
    } catch (e) {
      if (netzfehler(e)) {
        const q = lies(WARTESCHLANGE, []);
        q.push({ art, id, lat, lon, zeit: new Date().toISOString() });
        schreib(WARTESCHLANGE, q);
        renderWarte();
        return { wartend: true };
      }
      return { fehler: fehlertext(e) };
    } finally {
      entdeckerCache.delete(id);
      kommentarCache.delete(id);
    }
  }

  let sendetGerade = false;
  async function sendeWarteschlange() {
    if (!profil || sendetGerade) return;
    const q = lies(WARTESCHLANGE, []);
    if (!q.length) return;
    sendetGerade = true;
    const rest = [];
    let punkte = 0;
    for (const f of q) {
      try {
        const r = await rpc(f.art || 'sammeln', { p_anlage: f.id, p_lat: f.lat, p_lon: f.lon, p_zeit: f.zeit });
        punkte += (r && r.punkte) || 0;
      } catch (e) {
        if (netzfehler(e)) rest.push(f);  // später erneut; andere Fehler verwerfen
      }
    }
    schreib(WARTESCHLANGE, rest);
    sendetGerade = false;
    if (q.length > rest.length) {
      toast((q.length - rest.length) + ' Fund(e) übertragen' + (punkte ? ' · +' + punkte + ' Punkte' : ''));
      ladeRangliste();
    }
    renderWarte();
  }

  /* ---------- Erstentdecker (für die Zielkarte) ---------- */

  async function entdecker(id) {
    if (!profil) return null;
    if (entdeckerCache.has(id)) return entdeckerCache.get(id);
    try {
      const e = await rpc('erstfinder', { p_anlage: id });
      entdeckerCache.set(id, e);
      return e;
    } catch (_) {
      return null;
    }
  }

  /* ---------- Gruppen ---------- */

  async function ladeGruppen() {
    if (!profil) return;
    try {
      gruppen = await rpc('meine_gruppen') || [];
    } catch (e) {
      return toast('Gruppen nicht ladbar: ' + fehlertext(e));
    }
    if (gruppe !== GLOBAL && !gruppen.some((g) => g.id === gruppe)) gruppe = gruppen[0] ? gruppen[0].id : GLOBAL;
    schreib(GRUPPE_GEWAEHLT, gruppe);
  }

  async function gruppeErstellen() {
    const name = $('#inp-gruppe').value.trim();
    if (name.length < 2) return toast('Bitte einen Gruppennamen eingeben');
    try {
      const g = await rpc('gruppe_erstellen', { p_name: name });
      $('#inp-gruppe').value = '';
      gruppe = g.id;
      await ladeGruppen();
      toast('Gruppe erstellt – Code ' + g.code);
    } catch (e) { toast(fehlertext(e)); }
    render();
  }

  async function gruppeBeitreten() {
    const code = $('#inp-code').value.trim().toUpperCase();
    if (code.length !== 6) return toast('Der Code hat 6 Zeichen');
    try {
      const g = await rpc('gruppe_beitreten', { p_code: code });
      if (g.fehler) throw new Error(g.fehler);
      $('#inp-code').value = '';
      gruppe = g.id;
      await ladeGruppen();
      toast('Willkommen in „' + g.name + '“');
    } catch (e) { toast(fehlertext(e)); }
    render();
  }

  async function gruppeVerlassen() {
    const g = gruppen.find((x) => x.id === gruppe);
    if (!g || !confirm('Gruppe „' + g.name + '“ verlassen?')) return;
    try {
      await rpc('gruppe_verlassen', { p_gruppe: g.id });
      gruppe = null;
      await ladeGruppen();
    } catch (e) { toast(fehlertext(e)); }
    render();
  }

  function teilen() {
    const g = gruppen.find((x) => x.id === gruppe);
    if (!g) return;
    const text = 'Sammle mit mir Windräder in der Gruppe „' + g.name + '“! Einladungscode: ' + g.code +
      '\nApp: ' + location.origin + location.pathname;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Einladung kopiert'));
  }

  /* ---------- Darstellung ---------- */

  // Zeitraum [seit, bis) für die gewählte Auswertung
  function periode() {
    const j = new Date();
    if (zeitraum === 'monat') {
      const von = new Date(j.getFullYear(), j.getMonth() - versatz, 1);
      const bis = new Date(von.getFullYear(), von.getMonth() + 1, 1);
      return { seit: von.toISOString(), bis: bis.toISOString(), name: von.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) };
    }
    if (zeitraum === 'jahr') {
      const jahr = j.getFullYear() - versatz;
      return { seit: new Date(jahr, 0, 1).toISOString(), bis: new Date(jahr + 1, 0, 1).toISOString(), name: 'Jahr ' + jahr };
    }
    return { seit: null, bis: null, name: 'Seit Beginn' };
  }

  function zeile(z, platz) {
    const medaille = z.punkte > 0 ? ({ 1: '🥇', 2: '🥈', 3: '🥉' }[platz] || platz) : platz;
    const unter = [fmt0.format(z.anlagen) + ' Anlagen', fmt0.format(z.modelle) + ' Modelle'];
    if (z.beruehrt) unter.push(fmt0.format(z.beruehrt) + ' 🤚');
    return '<li' + (z.ich ? ' class="ich"' : '') + '><span class="platz">' + medaille + '</span>' +
      '<span class="li-text"><div class="li-titel">' + esc(z.name) + (z.ich ? ' (du)' : '') + '</div>' +
      '<div class="li-unter">' + unter.join(' · ') + '</div></span>' +
      '<span class="li-dist">' + fmt0.format(z.punkte) + '<small>Punkte</small></span></li>';
  }

  let ladeNr = 0;
  async function ladeRangliste() {
    if (!profil) return;
    try {
      const stand = await rpc('mein_stand');
      $('#rang-punkte').textContent = fmt0.format(stand.punkte);
      $('#rang-anlagen').textContent = fmt0.format(stand.anlagen) + ' Anlagen online gewertet';
    } catch (_) { /* offline */ }

    const ol = $('#rang-liste');
    if (!gruppe) { ol.innerHTML = ''; return; }
    const p = periode();
    $('#rang-periode').hidden = zeitraum === 'gesamt';
    $('#rang-periode-name').textContent = p.name;
    $('#btn-periode-vor').disabled = versatz === 0;
    const nr = ++ladeNr;
    try {
      let html;
      if (gruppe === GLOBAL) {
        const zeilen = await rpc('rangliste_global', { p_seit: p.seit, p_bis: p.bis });
        html = zeilen.map((z) => zeile(z, z.platz)).join('');
        if (!zeilen.some((z) => !z.ich)) html += '<li class="leer">Noch niemand sonst ist in diesem Zeitraum global sichtbar.</li>';
      } else {
        const zeilen = await rpc('rangliste', { p_gruppe: gruppe, p_seit: p.seit, p_bis: p.bis });
        let platz = 0, vorher = null;
        html = zeilen.map((z, i) => {
          if (z.punkte !== vorher) { platz = i + 1; vorher = z.punkte; }
          return zeile(z, platz);
        }).join('');
      }
      if (nr === ladeNr) ol.innerHTML = html;
    } catch (e) {
      if (nr === ladeNr) ol.innerHTML = '<li class="leer">Rangliste nicht ladbar (' + esc(fehlertext(e)) + ')</li>';
    }
  }

  async function globalSetzen(an) {
    const { error } = await sb.from('profile').update({ global: an }).eq('id', profil.id);
    if (error) {
      $('#chk-global').checked = !an;
      return toast('Ändern fehlgeschlagen: ' + fehlertext(error));
    }
    profil.global = an;
    toast(an ? 'Du bist jetzt in der globalen Rangliste sichtbar' : 'Du bist in der globalen Rangliste nicht mehr sichtbar');
    render();
  }

  function renderWarte() {
    const n = lies(WARTESCHLANGE, []).length;
    const el = $('#rang-warte');
    el.hidden = !n;
    el.textContent = n + (n === 1 ? ' Fund wartet' : ' Funde warten') + ' auf Netz und wird automatisch übertragen.';
  }

  function render() {
    if (!aktiv) return;
    $('#rang-anmelden').hidden = !!profil;
    $('#rang-inhalt').hidden = !profil;
    if (!profil) {
      if ($('#view-rang').classList.contains('aktiv')) {
        $('#btn-anmelden').disabled = !!cfg.turnstileSiteKey && !captchaToken && !hatSitzung;
        ladeCaptcha();
      }
      return;
    }
    $('#rang-name').textContent = profil.name;
    $('#chk-global').checked = !!profil.global;
    renderWarte();

    const global = gruppe === GLOBAL;
    $('#rang-gruppen').innerHTML = '<button data-g="' + GLOBAL + '"' + (global ? ' class="an"' : '') + '>🌍 Global</button>' +
      gruppen.map((g) =>
        '<button data-g="' + esc(g.id) + '"' + (g.id === gruppe ? ' class="an"' : '') + '>' + esc(g.name) +
        ' · ' + g.mitglieder + '</button>').join('');
    const g = gruppen.find((x) => x.id === gruppe);
    $('#rang-gruppe').hidden = !g && !global;
    $('#rang-keine').hidden = !!gruppen.length;
    $('#rang-gruppe-kopf').hidden = !g;
    $('#btn-verlassen').hidden = !g;
    if (g) $('#rang-code').textContent = g.code;
    $('#rang-global-hinweis').hidden = !global || profil.global;
    $('#rang-global-hinweis').textContent = 'Die globale Rangliste zeigt alle, die sich freigeschaltet haben. Du selbst bist dort nur für dich sichtbar – schalte oben „In der globalen Rangliste zeigen“ ein, damit andere dich sehen.';
    ladeRangliste();
  }

  async function ladeBlockierte() {
    const box = $('#rang-blockiert');
    try {
      const zeilen = await rpc('blockierte_lesen') || [];
      box.innerHTML = zeilen.length
        ? zeilen.map((z) => '<li><span class="li-text"><div class="li-titel">' + esc(z.name) + '</div><div class="li-unter">blockiert am ' +
            datum(Date.parse(z.zeit)) + '</div></span><button class="knopf klein-knopf" data-entblocken="' + esc(z.id) + '">Aufheben</button></li>').join('')
        : '<li class="leer">Du hast niemanden blockiert.</li>';
    } catch (_) { box.innerHTML = ''; }
  }

  // Beim Öffnen des Tabs aktualisieren
  async function zeigen() {
    if (!aktiv || !profil) return render();
    await ladeGruppen();
    render();
    sendeWarteschlange();
    ladeBlockierte();
  }

  /* ---------- Bewertungen ----------
   * Lesen: alle angemeldeten Spieler. Schreiben: nur wer die Anlage mit seinem Konto gesammelt hat
   * (prüft der Server). Eine Bewertung pro Spieler und Anlage, ab 3 Meldungen ausgeblendet. */

  let km = { id: null, gesammelt: false, zeilen: [], sterne: 0 };

  async function zeigeKommentare(id, gesammelt) {
    const box = $('#ziel-kommentare');
    if (!aktiv || !profil) { box.hidden = true; return; }
    box.hidden = false;
    // Nur bei Anlagen- oder Statuswechsel neu aufbauen – sonst würde jede GPS-Meldung das Eingabefeld leeren
    if (km.id === id && km.gesammelt === gesammelt) return;
    const neueAnlage = km.id !== id;
    km = { id, gesammelt, zeilen: neueAnlage ? [] : km.zeilen, sterne: 0 };
    if (neueAnlage) {
      box.open = false;
      $('#km-schnitt').textContent = '';
      $('#km-inhalt').innerHTML = '<p class="leise klein">Lade …</p>';
    }
    await ladeKommentare(id);
  }

  async function ladeKommentare(id, neu) {
    if (neu) kommentarCache.delete(id);
    let zeilen = kommentarCache.get(id);
    if (!zeilen) {
      try {
        zeilen = await rpc('kommentare_lesen', { p_anlage: id }) || [];
        kommentarCache.set(id, zeilen);
      } catch (e) {
        if (km.id === id) $('#km-inhalt').innerHTML = '<p class="leise klein">Bewertungen nicht ladbar (' + esc(fehlertext(e)) + ')</p>';
        return;
      }
    }
    if (km.id !== id) return;
    km.zeilen = zeilen;
    const eigene = zeilen.find((z) => z.ich);
    km.sterne = eigene ? eigene.sterne : 0;
    renderKommentare();
  }

  const sterneText = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  function renderKommentare() {
    const z = km.zeilen;
    const schnitt = z.length ? z.reduce((s, x) => s + x.sterne, 0) / z.length : 0;
    $('#km-schnitt').textContent = z.length ? '★ ' + schnitt.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' · ' + z.length : 'noch keine';
    const eigene = z.find((x) => x.ich);
    const liste = z.map((x) =>
      '<div class="km' + (x.ich ? ' ich' : '') + '"><div class="km-kopf"><b>' + esc(x.name) + (x.ich ? ' (du)' : '') + '</b>' +
      '<span class="km-sterne" aria-label="' + x.sterne + ' von 5 Sternen">' + sterneText(x.sterne) + '</span></div>' +
      (x.text ? '<p>' + esc(x.text) + '</p>' : '') +
      '<div class="km-fuss leise klein">' + datum(Date.parse(x.zeit)) +
      (x.ich ? '' : (x.gemeldet ? ' · gemeldet' : ' · <button class="link-knopf km-melden" data-melden="' + esc(x.id) + '">Melden</button>') +
        ' · <button class="link-knopf km-melden" data-blockieren="' + esc(x.id) + '" data-name="' + esc(x.name) + '">Blockieren</button>') +
      '</div></div>').join('');
    const formular = km.gesammelt
      ? '<div class="km-form"><div class="km-wahl" role="radiogroup" aria-label="Sterne">' +
        [1, 2, 3, 4, 5].map((n) => '<button data-stern="' + n + '" role="radio" aria-checked="' + (n === km.sterne) + '" aria-label="' + n + ' Sterne"' +
          (n <= km.sterne ? ' class="an"' : '') + '>★</button>').join('') + '</div>' +
        '<textarea id="km-text" class="eingabe km-text" maxlength="500" rows="3" placeholder="Wie war’s an dieser Anlage? (optional)">' +
        esc(eigene ? eigene.text : '') + '</textarea>' +
        '<div class="ziel-aktionen"><button class="knopf haupt" data-aktion="speichern">' + (eigene ? 'Ändern' : 'Bewerten') + '</button>' +
        (eigene ? '<button class="knopf" data-aktion="loeschen">Löschen</button>' : '') + '</div></div>'
      : '<p class="leise klein">Bewerten kannst du, sobald du die Anlage gesammelt hast.</p>';
    $('#km-inhalt').innerHTML = (liste || '<p class="leise klein">Noch keine Bewertungen – sei die/der Erste.</p>') + formular;
  }

  async function kommentarKlick(e) {
    const stern = e.target.closest('button[data-stern]');
    if (stern) {
      km.sterne = +stern.dataset.stern;
      document.querySelectorAll('#km-inhalt [data-stern]').forEach((b) => {
        b.classList.toggle('an', +b.dataset.stern <= km.sterne);
        b.setAttribute('aria-checked', +b.dataset.stern === km.sterne);
      });
      return;
    }
    const id = km.id;
    const melden = e.target.closest('button[data-melden]');
    if (melden) {
      if (!confirm('Diesen Kommentar als unangemessen melden?')) return;
      try {
        await rpc('kommentar_melden', { p_kommentar: melden.dataset.melden });
        toast('Danke, gemeldet');
      } catch (x) { return toast(fehlertext(x)); }
      return ladeKommentare(id, true);
    }
    const block = e.target.closest('button[data-blockieren]');
    if (block) {
      if (!confirm('„' + block.dataset.name + '“ blockieren? Du siehst dann keine Kommentare dieser Person mehr. Rückgängig machen kannst du das im Tab Rangliste.')) return;
      try {
        await rpc('nutzer_blockieren', { p_kommentar: block.dataset.blockieren });
        toast('Blockiert');
      } catch (x) { return toast(fehlertext(x)); }
      kommentarCache.clear();
      return ladeKommentare(id, true);
    }
    const knopf = e.target.closest('button[data-aktion]');
    if (!knopf) return;
    try {
      if (knopf.dataset.aktion === 'speichern') {
        if (!km.sterne) return toast('Bitte 1 bis 5 Sterne wählen');
        await rpc('kommentar_speichern', { p_anlage: id, p_sterne: km.sterne, p_text: $('#km-text').value });
        toast('Bewertung gespeichert');
      } else {
        if (!confirm('Deine Bewertung löschen?')) return;
        await rpc('kommentar_loeschen', { p_anlage: id });
        toast('Bewertung gelöscht');
      }
    } catch (x) {
      return toast(fehlertext(x));
    }
    ladeKommentare(id, true);
  }

  /* ---------- Ereignisse ---------- */

  if (aktiv) {
    $('#btn-anmelden').addEventListener('click', () => anmelden($('#inp-name').value));
    $('#inp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') anmelden(e.target.value); });
    $('#btn-erstellen').addEventListener('click', gruppeErstellen);
    $('#btn-beitreten').addEventListener('click', gruppeBeitreten);
    $('#btn-verlassen').addEventListener('click', gruppeVerlassen);
    $('#btn-teilen').addEventListener('click', teilen);
    $('#rang-name').addEventListener('click', umbenennen);
    $('#btn-konto-loeschen').addEventListener('click', kontoLoeschen);
    $('#rang-gruppen').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-g]');
      if (!b) return;
      gruppe = b.dataset.g;
      schreib(GRUPPE_GEWAEHLT, gruppe);
      render();
    });
    $('#rang-zeitraum').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-z]');
      if (!b) return;
      zeitraum = b.dataset.z;
      versatz = 0;
      document.querySelectorAll('#rang-zeitraum button').forEach((x) => x.classList.toggle('an', x === b));
      ladeRangliste();
    });
    $('#btn-periode-zurueck').addEventListener('click', () => { versatz++; ladeRangliste(); });
    $('#btn-periode-vor').addEventListener('click', () => { if (versatz > 0) { versatz--; ladeRangliste(); } });
    $('#chk-global').addEventListener('change', (e) => globalSetzen(e.target.checked));
    $('#km-inhalt').addEventListener('click', kommentarKlick);
    $('#rang-blockiert').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-entblocken]');
      if (!b) return;
      try { await rpc('entblocken', { p_id: b.dataset.entblocken }); } catch (x) { return toast(fehlertext(x)); }
      kommentarCache.clear();
      km.id = null;
      ladeBlockierte();
    });
    init();
  }

  return { aktiv, angemeldet: () => !!profil, sammeln, beruehren, entdecker, zeigen, zeigeKommentare };
})();
