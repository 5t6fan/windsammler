'use strict';
/* Online-Teil: Spielerprofil, Gruppen mit Einladungscode, Rangliste (Supabase).
 * Ohne Eintrag in config.js bleibt die App rein lokal und der Rangliste-Tab ist ausgeblendet.
 * Nutzt Hilfsfunktionen aus app.js ($, esc, toast, fmt0, datum).
 */
const Online = (() => {
  const cfg = window.WINDSAMMLER_CONFIG || {};
  const aktiv = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  const sb = aktiv ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  const WARTESCHLANGE = 'windsammler.warteschlange';
  const GRUPPE_GEWAEHLT = 'windsammler.gruppe';

  let profil = null;          // { id, name }
  let gruppen = [];
  let gruppe = null;          // gewählte Gruppen-ID
  let zeitraum = 'gesamt';
  const entdeckerCache = new Map();

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
    const { data, error } = await sb.from('profile').select('id,name').eq('id', uid).maybeSingle();
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

  async function anmelden(name) {
    name = name.trim();
    if (name.length < 2) return toast('Bitte mindestens 2 Zeichen');
    if (cfg.turnstileSiteKey && !captchaToken) return toast('Bitte die Sicherheitsprüfung abwarten');
    try {
      let { data: { session } } = await sb.auth.getSession();
      if (!session) {
        const r = await sb.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
        captchaZuruecksetzen();
        if (r.error) throw r.error;
        session = r.data.session;
      }
      const { error } = await sb.from('profile').upsert({ id: session.user.id, name });
      if (error) throw error;
      profil = { id: session.user.id, name };
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
  async function sammeln(id, lat, lon) {
    if (!profil) return null;
    try {
      return await rpc('sammeln', { p_anlage: id, p_lat: lat, p_lon: lon });
    } catch (e) {
      if (netzfehler(e)) {
        const q = lies(WARTESCHLANGE, []);
        q.push({ id, lat, lon, zeit: new Date().toISOString() });
        schreib(WARTESCHLANGE, q);
        renderWarte();
        return { wartend: true };
      }
      return { fehler: fehlertext(e) };
    } finally {
      entdeckerCache.delete(id);
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
        const r = await rpc('sammeln', { p_anlage: f.id, p_lat: f.lat, p_lon: f.lon, p_zeit: f.zeit });
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
      const daten = await rpc('entdecker', { p_anlage: id });
      const e = daten && daten[0] ? daten[0] : null;
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
    if (!gruppen.some((g) => g.id === gruppe)) gruppe = gruppen[0] ? gruppen[0].id : null;
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

  async function ladeRangliste() {
    if (!profil) return;
    try {
      const stand = await rpc('mein_stand');
      $('#rang-punkte').textContent = fmt0.format(stand.punkte);
      $('#rang-anlagen').textContent = fmt0.format(stand.anlagen) + ' Anlagen online gewertet';
    } catch (_) { /* offline */ }

    const ol = $('#rang-liste');
    if (!gruppe) { ol.innerHTML = ''; return; }
    const seit = zeitraum === 'monat' ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString() : null;
    try {
      const zeilen = await rpc('rangliste', { p_gruppe: gruppe, p_seit: seit });
      let platz = 0, vorher = null;
      ol.innerHTML = zeilen.map((z, i) => {
        if (z.punkte !== vorher) { platz = i + 1; vorher = z.punkte; }
        const medaille = z.punkte > 0 ? ({ 1: '🥇', 2: '🥈', 3: '🥉' }[platz] || platz) : platz;
        return '<li' + (z.ich ? ' class="ich"' : '') + '><span class="platz">' + medaille + '</span>' +
          '<span class="li-text"><div class="li-titel">' + esc(z.name) + (z.ich ? ' (du)' : '') + '</div>' +
          '<div class="li-unter">' + fmt0.format(z.anlagen) + ' Anlagen · ' + fmt0.format(z.modelle) + ' Modelle</div></span>' +
          '<span class="li-dist">' + fmt0.format(z.punkte) + '<small>Punkte</small></span></li>';
      }).join('');
    } catch (e) {
      ol.innerHTML = '<li class="leer">Rangliste nicht ladbar (' + esc(fehlertext(e)) + ')</li>';
    }
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
        $('#btn-anmelden').disabled = !!cfg.turnstileSiteKey && !captchaToken;
        ladeCaptcha();
      }
      return;
    }
    $('#rang-name').textContent = profil.name;
    renderWarte();

    $('#rang-gruppen').innerHTML = gruppen.map((g) =>
      '<button data-g="' + esc(g.id) + '"' + (g.id === gruppe ? ' class="an"' : '') + '>' + esc(g.name) +
      ' · ' + g.mitglieder + '</button>').join('');
    const g = gruppen.find((x) => x.id === gruppe);
    $('#rang-gruppe').hidden = !g;
    $('#rang-keine').hidden = !!g;
    if (g) $('#rang-code').textContent = g.code;
    ladeRangliste();
  }

  // Beim Öffnen des Tabs aktualisieren
  async function zeigen() {
    if (!aktiv || !profil) return render();
    await ladeGruppen();
    render();
    sendeWarteschlange();
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
      document.querySelectorAll('#rang-zeitraum button').forEach((x) => x.classList.toggle('an', x === b));
      ladeRangliste();
    });
    init();
  }

  return { aktiv, angemeldet: () => !!profil, sammeln, entdecker, zeigen };
})();
