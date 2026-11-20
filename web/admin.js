'use strict';
/* Admin-Seite: Überblick, gemeldete Kommentare prüfen, Spieler löschen.
 * Nutzt die Anmeldung der Web-App in diesem Browser. Freigeschaltet sind nur Konten in public.admins –
 * die Prüfung macht der Server (Funktionen admin_* in supabase/schema.sql), diese Seite zeigt nur an. */
(() => {
  const $ = (s) => document.querySelector(s);
  const fmt0 = new Intl.NumberFormat('de-DE');
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const zeit = (x) => x ? new Date(x).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
  const tag = (x) => x ? new Date(x).toLocaleDateString('de-DE') : '–';
  const cfg = window.WINDSAMMLER_CONFIG || {};
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  let toastTimer;
  function toast(t) {
    const el = $('#toast');
    el.textContent = t;
    el.classList.add('zeigen');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('zeigen'), 3000);
  }
  async function rpc(name, params) {
    const { data, error } = await sb.rpc(name, params);
    if (error) throw error;
    return data;
  }
  const status = (html) => { $('#status').hidden = false; $('#status').innerHTML = html; };

  async function start() {
    const { data } = await sb.auth.getSession();
    const s = data.session;
    if (!s) {
      return status('Du bist in diesem Browser nicht angemeldet. Öffne zuerst die <a href="./#rang">Web-App</a>, melde dich im Tab ' +
        'Rangliste mit einem Spielernamen an und komm dann hierher zurück.');
    }
    // Der Server prüft das Spielerprofil (public.ich()), nicht die Browser-Sitzung –
    // bei per Passwort verknüpften Geräten sind das verschiedene IDs.
    let profilId = s.user.id;
    try { profilId = (await rpc('ich')) || s.user.id; } catch (_) { /* Funktion fehlt oder offline */ }
    $('#meine-id').textContent = profilId;
    let admin = false;
    try { admin = await rpc('admin_ist'); } catch (_) { /* Funktion fehlt oder offline */ }
    if (!admin) {
      return status('<b>Dieses Konto ist nicht als Admin freigeschaltet.</b><br>Im Supabase-Dashboard unter <i>SQL Editor</i> ausführen:' +
        '<pre class="meldung-text">insert into public.admins (nutzer) values (\'' + esc(profilId) + '\');</pre>Danach diese Seite neu laden.');
    }
    $('#status').hidden = true;
    $('#inhalt').hidden = false;
    ladeAlles();
  }

  function ladeAlles() { ladeUebersicht(); ladeMeldungen(); ladeSpieler(); }

  async function ladeUebersicht() {
    try {
      const u = await rpc('admin_uebersicht');
      $('#zahlen').innerHTML = [
        [u.spieler, 'Spieler'], [u.neu7, 'neu (7 Tage)'], [u.aktiv7, 'aktiv (7 Tage)'], [u.aktiv30, 'aktiv (30 Tage)'],
        [u.global, 'global sichtbar'], [u.funde, 'Funde'], [u.funde7, 'Funde (7 Tage)'], [u.beruehrt, 'berührt'],
        [u.kommentare, 'Bewertungen'], [u.gruppen, 'Gruppen'], [u.offen, 'offene Meldungen'], [u.ausgeblendet, 'ausgeblendet'],
      ].map(([z, t]) => '<div class="zahl"><b>' + fmt0.format(z || 0) + '</b><span>' + t + '</span></div>').join('');
      if (u.aelteste_meldung) {
        const stunden = (Date.now() - Date.parse(u.aelteste_meldung)) / 36e5;
        $('#offen-zahl').textContent = '· älteste vor ' + (stunden < 1 ? 'unter 1 Std.' : Math.floor(stunden) + ' Std.');
      } else {
        $('#offen-zahl').textContent = '';
      }
    } catch (e) { toast('Überblick nicht ladbar: ' + e.message); }
  }

  async function ladeMeldungen() {
    const box = $('#meldungen');
    try {
      const liste = await rpc('admin_meldungen') || [];
      box.innerHTML = liste.length ? liste.map((m) =>
        '<div class="karte meldung"><div class="meldung-kopf"><b>' + esc(m.name) + '</b><span class="leise klein">' + '★'.repeat(m.sterne) + '☆'.repeat(5 - m.sterne) + '</span></div>' +
        '<div class="tags"><span class="tag' + (m.ausgeblendet ? ' rot' : '') + '">' + m.meldungen + (m.meldungen === 1 ? ' Meldung' : ' Meldungen') +
          (m.ausgeblendet ? ' · ausgeblendet' : '') + '</span><span class="tag">Anlage ' + esc(m.anlage) + '</span></div>' +
        '<div class="meldung-text">' + (m.text ? esc(m.text) : '<i class="leise">(nur Sterne, kein Text)</i>') + '</div>' +
        '<div class="leise klein">Geschrieben ' + zeit(m.zeit) + ' · erste Meldung ' + zeit(m.erste_meldung) + '</div>' +
        '<div class="ziel-aktionen">' +
          '<button class="knopf" data-verwerfen="' + esc(m.id) + '">Verwerfen</button>' +
          '<button class="knopf gefahr" data-kommentar="' + esc(m.id) + '">Kommentar löschen</button>' +
          '<button class="knopf gefahr" data-spieler="' + esc(m.verfasser) + '" data-name="' + esc(m.name) + '">Spieler löschen</button>' +
        '</div></div>').join('')
        : '<div class="karte leise">Keine offenen Meldungen. 🎉</div>';
    } catch (e) { box.innerHTML = '<div class="karte leise">Meldungen nicht ladbar: ' + esc(e.message) + '</div>'; }
  }

  async function ladeSpieler() {
    const ul = $('#spieler');
    const suche = $('#suche').value.trim() || null;
    try {
      const liste = await rpc('admin_spieler', { p_suche: suche }) || [];
      ul.innerHTML = liste.length ? liste.map((p) =>
        '<li><span class="li-text"><div class="li-titel">' + esc(p.name) + (p.admin ? ' · Admin' : '') + (p.global ? ' · 🌍' : '') + '</div>' +
        '<div class="li-unter">seit ' + tag(p.erstellt) + ' · ' + fmt0.format(p.funde) + ' Funde · zuletzt ' + tag(p.zuletzt) +
          ' · ' + fmt0.format(p.kommentare) + ' Bewertungen' + (p.gemeldet ? ' · ' + p.gemeldet + '× gemeldet' : '') + '</div></span>' +
        (p.admin ? '' : '<button class="knopf klein-knopf gefahr" data-spieler="' + esc(p.id) + '" data-name="' + esc(p.name) + '">Löschen</button>') +
        '</li>').join('')
        : '<li class="leer">Keine Spieler gefunden.</li>';
    } catch (e) { ul.innerHTML = '<li class="leer">Spieler nicht ladbar: ' + esc(e.message) + '</li>'; }
  }

  async function aktion(fn, erfolg) {
    try { await fn(); toast(erfolg); } catch (e) { toast('Fehler: ' + e.message); }
    ladeAlles();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.verwerfen) {
      aktion(() => rpc('admin_meldung_verwerfen', { p_kommentar: b.dataset.verwerfen }), 'Meldungen verworfen – Kommentar wieder sichtbar');
    } else if (b.dataset.kommentar) {
      if (confirm('Diesen Kommentar endgültig löschen?')) aktion(() => rpc('admin_kommentar_loeschen', { p_kommentar: b.dataset.kommentar }), 'Kommentar gelöscht');
    } else if (b.dataset.spieler) {
      const name = b.dataset.name;
      if (prompt('Spieler „' + name + '“ mit allen Daten endgültig löschen?\nZur Bestätigung den Namen eingeben:') === name) {
        aktion(() => rpc('admin_spieler_loeschen', { p_nutzer: b.dataset.spieler }), 'Spieler gelöscht');
      }
    } else if (b.id === 'btn-suche') {
      ladeSpieler();
    }
  });
  $('#suche').addEventListener('keydown', (e) => { if (e.key === 'Enter') ladeSpieler(); });

  start().catch((e) => status('Fehler: ' + esc(e.message)));
})();
