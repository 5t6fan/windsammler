'use strict';
/* Windsammler – Windenergieanlagen in der Nähe finden und sammeln.
 *
 * Test am Rechner (ohne GPS):  index.html?pos=51.2700,9.7394   feste Position
 *                              index.html?pos=…&test           Sammeln/Berühren ohne Entfernungsgrenze
 */

const PARAM = new URLSearchParams(location.search);
const TESTMODUS = PARAM.has('test');
const SAMMEL_RADIUS = TESTMODUS ? Infinity : 300;   // Meter
const BERUEHR_RADIUS = TESTMODUS ? Infinity : 20;   // Meter – „Turm berührt“
const KUHKRATZER = 20;    // Meter – untere Blattspitze näher am Boden als das: „Kuhkratzer“
// Abstand der unteren Blattspitze zum Boden (Nabenhöhe minus halber Rotordurchmesser)
const freiraum = (a) => (a.nabe && a.rotor ? a.nabe - a.rotor / 2 : null);
const istKuhkratzer = (a) => { const f = freiraum(a); return f != null && f < KUHKRATZER; };
const AKTIV_MIN = 10;     // ein Modell zählt als „aktiv“, wenn so viele Anlagen an Land in Betrieb sind
const LISTE_MAX = 50;
const SPEICHER = 'windsammler.v1';

const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const fmt0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

const S = {
  d: null, F: null, n: 0, lat: null, lon: null,
  idIndex: new Map(), modellAnzahl: new Map(), parkAnzahl: new Map(), markeAnzahl: new Map(),
  katalog: new Map(),        // "Marke|Modell" -> aktives Modell (Kennwerte für Quartettkarten)
  aktivProMarke: new Map(),  // Marke -> [aktive Modelle]
  abgebaut: {},              // MaStR-Nummer -> Datum der endgültigen Stilllegung
  planungIdx: -1,
  pos: null, heading: null, radius: 5000, planung: false,
  sel: null, manuell: false, nah: [], naechste: null,
  heft: ladeHeft(),
  map: null, layer: null, fundLayer: null, ich: null, ersterFix: true, fundeAufKarte: false,
  verlauf: { art: 'monat', wert: 'anlagen', sel: null }, fundFilter: 'alle',
};

/* ---------------- Daten ---------------- */

fetch('data/wind.json')
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(init)
  .catch((e) => status('Daten konnten nicht geladen werden (' + e.message + ')'));

function init(d) {
  S.d = d;
  S.F = Object.fromEntries(d.felder.map((f, i) => [f, i]));
  S.n = d.anlagen.length;
  S.lat = new Float64Array(S.n);
  S.lon = new Float64Array(S.n);
  S.planungIdx = d.status.indexOf('In Planung');
  S.abgebaut = d.abgebaut || {};
  const betriebIdx = d.status.indexOf('In Betrieb');
  const F = S.F;
  const roh = new Map();
  d.anlagen.forEach((z, i) => {
    S.lat[i] = z[F.lat];
    S.lon[i] = z[F.lon];
    S.idIndex.set(z[F.id], i);
    if (z[F.status] === S.planungIdx) return;
    zaehle(S.markeAnzahl, z[F.hersteller]);
    if (z[F.modell]) zaehle(S.modellAnzahl, z[F.hersteller] + '|' + z[F.modell]);
    if (z[F.park]) zaehle(S.parkAnzahl, parkKey(z));
    // Katalog: nur an Land und in Betrieb – also tatsächlich sammelbar
    if (z[F.status] !== betriebIdx || z[F.see] === 1 || !z[F.modell] || z[F.hersteller] == null) return;
    const k = d.hersteller[z[F.hersteller]] + '|' + z[F.modell];
    if (!roh.has(k)) roh.set(k, { n: 0, kw: [], rotor: [], nabe: [], ibn: null });
    const r = roh.get(k);
    r.n++;
    if (z[F.kw]) r.kw.push(z[F.kw]);
    if (z[F.rotor]) r.rotor.push(z[F.rotor]);
    if (z[F.nabe]) r.nabe.push(z[F.nabe]);
    if (z[F.ibn] && (!r.ibn || z[F.ibn] < r.ibn)) r.ibn = z[F.ibn];
  });
  for (const [k, r] of roh) {
    if (r.n < AKTIV_MIN) continue;
    const [marke, modell] = k.split('|');
    const m = {
      k, marke, modell, n: r.n, kw: median(r.kw), rotor: median(r.rotor), ibn: r.ibn,
      nabe: median(r.nabe), nabeMin: r.nabe.length ? Math.min(...r.nabe) : null, nabeMax: r.nabe.length ? Math.max(...r.nabe) : null,
    };
    S.katalog.set(k, m);
    if (!S.aktivProMarke.has(marke)) S.aktivProMarke.set(marke, []);
    S.aktivProMarke.get(marke).push(m);
  }
  for (const liste of S.aktivProMarke.values()) liste.sort((a, b) => b.n - a.n);

  aktualisiereHeft();
  status(fmt0.format(S.n) + ' Anlagen · Stand ' + datum(d.meta.datenstand));
  $('#quelle').textContent = 'Daten: ' + d.meta.quelle + ', Stand ' + datum(d.meta.datenstand) + '.';
  $('#btn-start').disabled = false;
  initKarte();
  const neu = pruefeAbzeichen();
  if (neu.length) { speichereHeft(); toast(neu.map((x) => x.ico + ' ' + x.name).join(' · ')); }
  renderHeft();
  if (location.hash === '#heft' || location.hash === '#rang') zeigeView(location.hash.slice(1));
  if (PARAM.has('karte')) vollbild(true);

  const p = PARAM.get('pos');
  if (p) {
    const [la, lo] = p.split(',').map(Number);
    if (isFinite(la) && isFinite(lo)) neuePosition({ lat: la, lon: lo, acc: 5 });
  }
}

// Funde an den aktuellen Datenstand anpassen: Koordinaten nachtragen (für die Karte, auch nach
// einem Abbau) und Modellnamen angleichen, falls die Pipeline sie inzwischen sauberer erkennt.
function aktualisiereHeft() {
  let geaendert = false;
  for (const [id, f] of Object.entries(S.heft.funde)) {
    const i = S.idIndex.get(id);
    if (i == null) continue;
    const a = anlage(i);
    const neu = { lat: a.lat, lon: a.lon, marke: a.marke, modell: a.modell, rotor: a.rotor };
    for (const [k, v] of Object.entries(neu)) {
      if (v != null && f[k] !== v) { f[k] = v; geaendert = true; }
    }
  }
  if (geaendert) speichereHeft();
}

function zaehle(map, key) { map.set(key, (map.get(key) || 0) + 1); }
function parkKey(z) { return z[S.F.park] + '|' + z[S.F.kreis]; }
function median(werte) {
  if (!werte.length) return null;
  const s = werte.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

function anlage(i) {
  const z = S.d.anlagen[i], F = S.F;
  const h = z[F.hersteller];
  return {
    i, id: z[F.id], lat: z[F.lat], lon: z[F.lon], name: z[F.name], park: z[F.park],
    marke: h != null ? S.d.hersteller[h] : null, markeIdx: h,
    typ: z[F.typ], modell: z[F.modell], kw: z[F.kw], nabe: z[F.nabe], rotor: z[F.rotor],
    ibn: z[F.ibn], status: S.d.status[z[F.status]], planung: z[F.status] === S.planungIdx,
    ort: z[F.ort], kreis: z[F.kreis], land: z[F.land] != null ? S.d.bundesland[z[F.land]] : null,
    see: z[F.see] === 1, parkKey: z[F.park] ? parkKey(z) : null,
  };
}

const istAbgebaut = (id) => !!S.d && !S.idIndex.has(id);

/* ---------------- Geometrie ---------------- */

const RAD = Math.PI / 180;
function distanz(la1, lo1, la2, lo2) {
  const dLa = (la2 - la1) * RAD, dLo = (lo2 - lo1) * RAD;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(dLo / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(a));
}
function peilung(la1, lo1, la2, lo2) {
  const y = Math.sin((lo2 - lo1) * RAD) * Math.cos(la2 * RAD);
  const x = Math.cos(la1 * RAD) * Math.sin(la2 * RAD) - Math.sin(la1 * RAD) * Math.cos(la2 * RAD) * Math.cos((lo2 - lo1) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
const RICHTUNGEN = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
const KURZ = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const PFEILE = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const sektor = (grad) => Math.round(grad / 45) % 8;

function entfernung(m) {
  if (m < 1000) return fmt0.format(Math.round(m / 10) * 10) + ' m';
  return fmt.format(m / 1000) + ' km';
}

/* ---------------- Standort & Kompass ---------------- */

$('#btn-start').addEventListener('click', async () => {
  // iOS verlangt die Kompass-Freigabe direkt aus einem Tipp heraus
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { await DeviceOrientationEvent.requestPermission(); } catch (_) { /* ohne Kompass weiter */ }
  }
  starteKompass();
  if (!('geolocation' in navigator)) return status('Dieses Gerät liefert keinen Standort.');
  status('Suche Standort …');
  navigator.geolocation.watchPosition(
    (p) => neuePosition({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
    (e) => status(e.code === 1 ? 'Standort nicht freigegeben – bitte in den Einstellungen erlauben.' : 'Standort nicht verfügbar.'),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
});

function starteKompass() {
  const winkel = () => (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  window.addEventListener('deviceorientation', (e) => {
    if (e.webkitCompassHeading != null) setzeHeading(e.webkitCompassHeading + winkel());
  });
  window.addEventListener('deviceorientationabsolute', (e) => {
    if (e.alpha != null) setzeHeading(360 - e.alpha + winkel());
  });
}

let pfeilFrame = 0;
function setzeHeading(h) {
  S.heading = (h + 360) % 360;
  if (!pfeilFrame) pfeilFrame = requestAnimationFrame(() => { pfeilFrame = 0; drehePfeil(); });
}

let letzteBerechnung = null;
function neuePosition(p) {
  S.pos = p;
  $('#start').hidden = true;
  $('#ziel').hidden = false;
  if (!TESTMODUS || !PARAM.get('pos')) status('Genauigkeit ± ' + fmt0.format(p.acc) + ' m');
  // Liste nur neu berechnen, wenn man sich merklich bewegt hat
  if (!letzteBerechnung || distanz(p.lat, p.lon, letzteBerechnung.lat, letzteBerechnung.lon) > 15) {
    letzteBerechnung = p;
    berechneNah();
  }
  renderAlles();
}

function berechneNah() {
  const { lat, lon } = S.pos;
  const nah = [];
  let best = null, bestD = Infinity;
  // Nächste Anlage, die man noch nicht hat bzw. noch nicht berührt hat – unabhängig vom Radius
  let neu = null, neuD = Infinity, unb = null, unbD = Infinity;
  const F = S.F;
  for (let i = 0; i < S.n; i++) {
    const z = S.d.anlagen[i];
    const geplant = z[F.status] === S.planungIdx;
    if (geplant && !S.planung) continue;
    const grob = Math.abs(S.lat[i] - lat) * 111320;
    if (grob > S.radius && grob > bestD && grob > neuD && grob > unbD) continue;
    const d = distanz(lat, lon, S.lat[i], S.lon[i]);
    if (d < bestD) { bestD = d; best = i; }
    if (d <= S.radius) nah.push({ i, d });
    if (geplant || z[F.see] === 1) continue;
    const f = S.heft.funde[z[F.id]];
    if (!f && d < neuD) { neuD = d; neu = i; }
    if (!(f && f.b) && d < unbD) { unbD = d; unb = i; }
  }
  nah.sort((a, b) => a.d - b.d);
  S.nah = nah;
  S.naechste = best;
  S.neu = neu;
  S.unberuehrt = unb;
  if (!S.manuell || S.sel == null) S.sel = best;
}

/* ---------------- Darstellung: In der Nähe ---------------- */

function renderAlles() {
  renderZiel();
  renderListe();
  renderKarte();
}

function renderZiel() {
  if (S.sel == null || !S.pos) return;
  const a = anlage(S.sel);
  const d = distanz(S.pos.lat, S.pos.lon, a.lat, a.lon);
  const b = peilung(S.pos.lat, S.pos.lon, a.lat, a.lon);
  const fund = S.heft.funde[a.id];

  $('#ziel-label').textContent = S.manuell && S.sel !== S.naechste ? 'Ausgewählte Anlage' : 'Nächste Anlage';
  $('#ziel-dist').textContent = entfernung(d);
  $('#ziel-richtung').textContent = 'Richtung ' + RICHTUNGEN[sektor(b)] + ' (' + fmt0.format(b) + '°)';
  $('#ziel-titel').textContent = titel(a);
  $('#ziel-ort').textContent = [a.park || a.name, a.ort, a.kreis].filter(Boolean).join(' · ');
  $('#ziel-text').textContent = beschreibung(a);
  $('#ziel-tags').innerHTML = tags(a, fund);

  const knopf = $('#btn-sammeln');
  if (fund) {
    knopf.disabled = true;
    knopf.textContent = '✓ Gesammelt am ' + datum(fund.t);
  } else if (a.planung) {
    knopf.disabled = true;
    knopf.textContent = 'Geplant – noch nicht sammelbar';
  } else if (d > SAMMEL_RADIUS) {
    knopf.disabled = true;
    knopf.textContent = 'Sammeln ab ' + SAMMEL_RADIUS + ' m (noch ' + entfernung(d - SAMMEL_RADIUS) + ')';
  } else {
    knopf.disabled = false;
    knopf.textContent = '★ Jetzt sammeln';
  }

  // Berühren: erst in Sammelreichweite sichtbar, aktiv unter 20 m
  const ber = $('#btn-beruehren');
  ber.hidden = a.planung || (!(fund && fund.b) && d > SAMMEL_RADIUS);
  if (fund && fund.b) {
    ber.disabled = true;
    ber.textContent = '🤚 Berührt am ' + datum(fund.b);
  } else if (d > BERUEHR_RADIUS) {
    ber.disabled = true;
    ber.textContent = '🤚 Berühren unter ' + BERUEHR_RADIUS + ' m';
  } else {
    ber.disabled = false;
    ber.textContent = '🤚 Turm berührt';
  }

  $('#btn-naechste').hidden = !(S.manuell && S.sel !== S.naechste);
  $('#map-info-dist').textContent = entfernung(d) + ' ' + KURZ[sektor(b)] + (fund ? ' ✓' : '');
  $('#map-info-titel').textContent = titel(a) + (a.park ? ' · ' + a.park : '');
  S.zielPeilung = b;
  renderNeu();
  drehePfeil();
  zeigeEntdecker(a.id);
  if (typeof Online !== 'undefined') Online.zeigeKommentare(a.id, !!fund);
}

// Erstentdecker und Erstberührer (nur mit Rangliste)
async function zeigeEntdecker(id) {
  const el = $('#ziel-entdecker');
  if (typeof Online === 'undefined' || !Online.angemeldet()) { el.hidden = true; return; }
  const e = await Online.entdecker(id);
  if (S.sel == null || anlage(S.sel).id !== id) return;  // inzwischen andere Anlage gewählt
  const wer = (x) => (x.ich ? 'dir' : x.name || 'einem anderen Spieler') + ' am ' + datum(Date.parse(x.zeit));
  const zeilen = [];
  if (e && e.entdeckt) zeilen.push('🚩 Erstentdeckt von ' + wer(e.entdeckt));
  if (e && e.beruehrt) zeilen.push('🖐️ Zuerst berührt von ' + wer(e.beruehrt));
  if (e && !e.entdeckt) zeilen.push('✨ Noch von niemandem entdeckt – sei die/der Erste!');
  el.hidden = !zeilen.length;
  el.innerHTML = zeilen.map(esc).join('<br>');
}

// Kleine Anzeige oben links auf der Karte: nächste neue und nächste unberührte Anlage
function renderNeu() {
  const el = $('#map-neu');
  if (!S.pos || !S.d) { el.hidden = true; return; }
  const zeile = (i, ico, text) => {
    const a = anlage(i);
    const d = distanz(S.pos.lat, S.pos.lon, a.lat, a.lon);
    const b = peilung(S.pos.lat, S.pos.lon, a.lat, a.lon);
    return '<button data-i="' + i + '" aria-label="' + esc(text + ': ' + titel(a) + ', ' + entfernung(d) + ' Richtung ' + RICHTUNGEN[sektor(b)]) + '">' +
      '<span class="mn-ico">' + ico + '</span><span class="mn-text">' + text + '</span><b>' + entfernung(d) + '</b>' +
      '<span class="mn-pfeil" data-b="' + b + '">↑</span></button>';
  };
  const html = [];
  if (S.neu != null && S.neu === S.unberuehrt) html.push(zeile(S.neu, '★', 'Neu'));
  else {
    if (S.neu != null) html.push(zeile(S.neu, '★', 'Neu'));
    if (S.unberuehrt != null) html.push(zeile(S.unberuehrt, '🤚', 'Unberührt'));
  }
  el.hidden = !html.length;
  el.innerHTML = html.join('');
  dreheNeu();
}
// Pfeile relativ zur Blickrichtung (ohne Kompass: relativ zu Norden)
function dreheNeu() {
  document.querySelectorAll('#map-neu .mn-pfeil').forEach((p) => {
    const b = +p.dataset.b;
    p.style.transform = 'rotate(' + (S.heading == null ? b : b - S.heading) + 'deg)';
  });
}
$('#map-neu').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (b) waehle(+b.dataset.i, true);
});

function drehePfeil() {
  dreheNeu();
  if (S.zielPeilung == null) return;
  const ohneKompass = S.heading == null;
  $('#kompass-hinweis').hidden = !ohneKompass;
  const winkel = ohneKompass ? S.zielPeilung : S.zielPeilung - S.heading;
  $('#pfeil').style.transform = 'rotate(' + winkel + 'deg)';
  $('#pfeil-mini').style.transform = 'rotate(' + winkel + 'deg)';
}

function titel(a) {
  const modell = a.modell || a.typ;
  if (a.marke && modell) return a.marke + ' ' + modell;
  return a.marke || modell || 'Windenergieanlage';
}

// „Rotordurchmesser 90 m bis 120 m“ statt nur „90 m bis 120 m“; Plattformen behalten ihren Namen
function quartettLabel(q) {
  return q.gruppe === 'Plattformen & Technik' ? q.name : q.text + ' ' + q.name.charAt(0).toLowerCase() + q.name.slice(1);
}

function beschreibung(a) {
  const s = [];
  if (a.kw) s.push('Leistung ' + fmt.format(a.kw / 1000) + ' MW.');
  if (a.nabe && a.rotor) {
    s.push('Nabenhöhe ' + fmt0.format(a.nabe) + ' m, Rotordurchmesser ' + fmt0.format(a.rotor) +
      ' m – mit Blattspitze rund ' + fmt0.format(a.nabe + a.rotor / 2) + ' m hoch.');
    if (istKuhkratzer(a)) s.push('Kuhkratzer: Die untere Blattspitze kommt dem Boden bis auf rund ' + fmt0.format(freiraum(a)) + ' m nahe.');
  } else if (a.nabe) {
    s.push('Nabenhöhe ' + fmt0.format(a.nabe) + ' m.');
  }
  if (a.ibn) {
    const jahr = +a.ibn.slice(0, 4);
    const alter = new Date().getFullYear() - jahr;
    if (a.planung) s.push('Geplante Inbetriebnahme ' + jahr + '.');
    else s.push('In Betrieb seit ' + jahr + (alter > 0 ? ' (' + alter + (alter === 1 ? ' Jahr' : ' Jahre') + ').' : '.'));
  }
  if (a.typ && a.modell && a.typ.toUpperCase() !== a.modell.toUpperCase()) s.push('Typ laut Register: ' + a.typ + '.');
  const n = a.modell && S.modellAnzahl.get(a.markeIdx + '|' + a.modell);
  if (n) {
    s.push(n <= 20
      ? 'Selten: nur ' + n + (n === 1 ? ' Anlage' : ' Anlagen') + ' dieses Modells in Deutschland.'
      : 'Eine von ' + fmt0.format(n) + ' Anlagen dieses Modells in Deutschland.');
  }
  const q = QUARTETTE.filter((x) => a.marke && S.katalog.has(a.marke + '|' + a.modell) && x.test(S.katalog.get(a.marke + '|' + a.modell)));
  if (q.length) s.push('Quartette: ' + q.map(quartettLabel).join(', ') + '.');
  return s.join(' ');
}

function tags(a, fund) {
  const t = [];
  if (fund) t.push('<span class="tag gesammelt">✓ gesammelt</span>');
  if (fund && fund.b) t.push('<span class="tag gesammelt">🤚 berührt</span>');
  if (a.planung) t.push('<span class="tag planung">in Planung</span>');
  else if (a.status !== 'In Betrieb') t.push('<span class="tag planung">' + esc(a.status) + '</span>');
  if (a.see) t.push('<span class="tag">offshore</span>');
  const n = a.modell && S.modellAnzahl.get(a.markeIdx + '|' + a.modell);
  if (n && n <= 20) t.push('<span class="tag selten">💎 selten</span>');
  if (a.ibn && a.ibn < '2000' && !a.planung) t.push('<span class="tag">🕰️ Oldtimer</span>');
  if (a.nabe >= 160) t.push('<span class="tag">🗼 Riese</span>');
  if (istKuhkratzer(a)) t.push('<span class="tag">🐄 Kuhkratzer</span>');
  return t.join('');
}

function renderListe() {
  const ul = $('#liste');
  $('#liste-titel').textContent = 'Im Umkreis von ' + entfernung(S.radius) + ' (' + fmt0.format(S.nah.length) + ')';
  if (!S.nah.length) {
    ul.innerHTML = '<li class="leer">Keine Anlage in diesem Umkreis – vergrößere den Radius.</li>';
    return;
  }
  ul.innerHTML = S.nah.slice(0, LISTE_MAX).map(({ i, d }) => {
    const a = anlage(i);
    const b = peilung(S.pos.lat, S.pos.lon, a.lat, a.lon);
    const f = S.heft.funde[a.id];
    const haken = f ? (f.b ? ' ✓🤚' : ' ✓') : '';
    return '<li data-i="' + i + '"' + (i === S.sel ? ' class="gewaehlt"' : '') + '>' +
      '<span class="li-pfeil">' + PFEILE[sektor(b)] + '</span>' +
      '<span class="li-text"><div class="li-titel">' + esc(titel(a)) + haken + '</div>' +
      '<div class="li-unter">' + esc([a.park || a.name, a.ort].filter(Boolean).join(' · ')) +
      (a.planung ? ' · geplant' : '') + '</div></span>' +
      '<span class="li-dist">' + entfernung(d) + '<small>' + KURZ[sektor(b)] + '</small></span></li>';
  }).join('') + (S.nah.length > LISTE_MAX ? '<li class="leer">… und ' + fmt0.format(S.nah.length - LISTE_MAX) + ' weitere auf der Karte</li>' : '');
}

$('#liste').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) waehle(+li.dataset.i, true);
});

function waehle(i, zentrieren) {
  S.sel = i;
  S.manuell = i !== S.naechste;
  renderAlles();
  if (zentrieren && S.map) S.map.panTo([S.lat[i], S.lon[i]]);
  if (!istVollbild()) window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('#btn-naechste').addEventListener('click', () => {
  S.manuell = false;
  S.sel = S.naechste;
  renderAlles();
});

/* ---------------- Karte ---------------- */

const FARBE = { gewaehlt: '#e0452b', gesammelt: '#c58b12', aktiv: '#0e6b58', planung: '#8a8f99', abgebaut: '#7b4fb0' };

function initKarte() {
  S.map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([51.2, 10.4], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(S.map);
  S.fundLayer = L.layerGroup().addTo(S.map);
  S.layer = L.layerGroup().addTo(S.map);
}

function farbe(a, gewaehlt) {
  if (gewaehlt) return FARBE.gewaehlt;
  if (S.heft.funde[a.id]) return FARBE.gesammelt;
  return a.planung ? FARBE.planung : FARBE.aktiv;
}

function renderKarte() {
  if (!S.map) return;
  renderFundLayer();
  if (!S.pos) return;
  const { lat, lon } = S.pos;
  S.layer.clearLayers();

  const liste = S.nah.slice();
  if (S.sel != null && !liste.some((x) => x.i === S.sel)) liste.push({ i: S.sel });
  for (const { i } of liste) {
    const a = anlage(i);
    const gewaehlt = i === S.sel;
    L.circleMarker([a.lat, a.lon], {
      radius: gewaehlt ? 10 : 6,
      color: '#fff', weight: 2,
      fillColor: farbe(a, gewaehlt), fillOpacity: a.planung ? 0.6 : 0.95,
      dashArray: a.planung ? '3' : null,
    }).on('click', () => waehle(i, false)).addTo(S.layer);
  }

  if (S.sel != null) {
    L.polyline([[lat, lon], [S.lat[S.sel], S.lon[S.sel]]], { color: FARBE.gewaehlt, weight: 3, dashArray: '6 8', opacity: 0.8 }).addTo(S.layer);
    // Pfeilspitze in der Mitte der Linie: zeigt von meinem Standort zur Anlage
    const b = peilung(lat, lon, S.lat[S.sel], S.lon[S.sel]);
    L.marker([(lat + S.lat[S.sel]) / 2, (lon + S.lon[S.sel]) / 2], {
      icon: L.divIcon({
        className: '', iconSize: [24, 24], iconAnchor: [12, 12],
        html: '<svg class="weg-pfeil" viewBox="0 0 24 24" style="transform:rotate(' + b + 'deg)"><path d="M12 2 L21 21 L12 16 L3 21 Z"/></svg>',
      }),
      interactive: false, keyboard: false,
    }).addTo(S.layer);
  }
  if (!S.ich) {
    S.ich = L.marker([lat, lon], {
      icon: L.divIcon({ className: '', html: '<div class="ich-punkt"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      zIndexOffset: 1000, interactive: false,
    }).addTo(S.map);
  } else {
    S.ich.setLatLng([lat, lon]);
  }

  if (S.ersterFix) {
    S.ersterFix = false;
    zentriere();
  }
}

// Alle eigenen Funde – deutschlandweit, auch ohne Standort; abgebaute lila
let fundLayerStand = '';
function renderFundLayer() {
  const stand = S.fundeAufKarte + '|' + Object.keys(S.heft.funde).length + '|' + S.nah.length + '|' + (S.nah[0] ? S.nah[0].i : '');
  if (stand === fundLayerStand) return;
  fundLayerStand = stand;
  S.fundLayer.clearLayers();
  if (!S.fundeAufKarte) return;
  for (const [id, f] of Object.entries(S.heft.funde)) {
    if (f.lat == null) continue;
    const i = S.idIndex.get(id);
    if (i != null && S.nah.some((x) => x.i === i)) continue;  // liegt schon als normaler Punkt auf der Karte
    const weg = i == null;
    L.circleMarker([f.lat, f.lon], {
      radius: weg ? 8 : 6, color: '#fff', weight: 2,
      fillColor: weg ? FARBE.abgebaut : FARBE.gesammelt, fillOpacity: 0.95,
    }).bindPopup(fundPopup(id, f)).on('click', () => { if (!weg && S.pos) waehle(i, false); }).addTo(S.fundLayer);
  }
}

function fundPopup(id, f) {
  const weg = istAbgebaut(id);
  return '<b>' + esc(fundTitel(f)) + '</b><br>' + esc([f.ort, f.kreis].filter(Boolean).join(' · ')) +
    '<br>Gesammelt ' + datum(f.t) + (f.b ? ' · 🤚 berührt' : '') +
    (weg ? '<br>🪦 abgebaut' + (S.abgebaut[id] ? ' ' + datum(S.abgebaut[id]) : '') : '');
}

function zeigeFundeAufKarte(an) {
  S.fundeAufKarte = an;
  $('#btn-funde').classList.toggle('an', an);
  $('#btn-funde').setAttribute('aria-pressed', an);
  renderKarte();
  if (!an) return;
  const punkte = Object.values(S.heft.funde).filter((f) => f.lat != null).map((f) => [f.lat, f.lon]);
  if (!punkte.length) return toast('Noch keine Funde für die Karte');
  if (S.pos) punkte.push([S.pos.lat, S.pos.lon]);
  S.map.fitBounds(punkte, { padding: [40, 40], maxZoom: 14 });
}
$('#btn-funde').addEventListener('click', () => zeigeFundeAufKarte(!S.fundeAufKarte));

function zentriere() {
  if (!S.pos) return;
  const punkte = [[S.pos.lat, S.pos.lon]];
  if (S.sel != null) punkte.push([S.lat[S.sel], S.lon[S.sel]]);
  S.nah.slice(0, 8).forEach(({ i }) => punkte.push([S.lat[i], S.lon[i]]));
  S.map.fitBounds(punkte, { padding: [40, 40], maxZoom: 15 });
}
$('#btn-zentrieren').addEventListener('click', zentriere);

// Nach Wahl des Radius: alle Anlagen im Umkreis vollständig zeigen (ohne Anlagen: den ganzen Kreis)
function zeigeUmkreis() {
  if (!S.pos || !S.map) return;
  const ich = L.latLng(S.pos.lat, S.pos.lon);
  const rahmen = S.nah.length ? L.latLngBounds([ich]) : ich.toBounds(S.radius * 2);
  S.nah.forEach(({ i }) => rahmen.extend([S.lat[i], S.lon[i]]));
  if (S.sel != null) rahmen.extend([S.lat[S.sel], S.lon[S.sel]]);
  S.map.fitBounds(rahmen, { padding: [30, 30], maxZoom: 15 });
}

/* Vollbild-Karte */
const istVollbild = () => $('#map-wrap').classList.contains('vollbild');
function vollbild(an) {
  $('#map-wrap').classList.toggle('vollbild', an);
  document.body.classList.toggle('vollbild-an', an);
  const knopf = $('#btn-vollbild');
  knopf.textContent = an ? '✕' : '⤢';
  knopf.setAttribute('aria-label', an ? 'Vollbild schließen' : 'Karte im Vollbild');
  // Leaflet muss die neue Größe kennen (behält dabei den Mittelpunkt bei)
  if (S.map) setTimeout(() => S.map.invalidateSize({ animate: false }), 30);
}
$('#btn-vollbild').addEventListener('click', () => vollbild(!istVollbild()));
$('#map-info').addEventListener('click', () => { vollbild(false); window.scrollTo({ top: 0, behavior: 'smooth' }); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && istVollbild()) vollbild(false); });

/* ---------------- Filter ---------------- */

$('#radius').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-r]');
  if (!b) return;
  document.querySelectorAll('#radius button').forEach((x) => x.classList.toggle('an', x === b));
  S.radius = +b.dataset.r;
  if (S.pos) { berechneNah(); renderAlles(); zeigeUmkreis(); }
});

$('#chk-planung').addEventListener('change', (e) => {
  S.planung = e.target.checked;
  if (S.pos) { berechneNah(); renderAlles(); }
});

/* ---------------- Sammeln & Berühren ---------------- */

function ladeHeft() {
  try {
    const h = JSON.parse(localStorage.getItem(SPEICHER));
    if (h && h.funde) return h;
  } catch (_) { /* leer starten */ }
  return { v: 1, funde: {}, abzeichen: {} };
}
function speichereHeft() {
  try { localStorage.setItem(SPEICHER, JSON.stringify(S.heft)); } catch (_) { toast('Speichern nicht möglich'); }
}

$('#btn-sammeln').addEventListener('click', () => sammle(false));
$('#btn-beruehren').addEventListener('click', () => sammle(true));

async function sammle(beruehrt) {
  if (S.sel == null || !S.pos) return;
  const a = anlage(S.sel);
  const d = distanz(S.pos.lat, S.pos.lon, a.lat, a.lon);
  const alt = S.heft.funde[a.id];
  if (a.planung) return;
  if (beruehrt ? d > BERUEHR_RADIUS || (alt && alt.b) : d > SAMMEL_RADIUS || alt) return;

  const funde = Object.values(S.heft.funde);
  const neuesModell = !alt && a.modell && !funde.some((f) => f.marke === a.marke && f.modell === a.modell);
  const neueMarke = !alt && a.marke && !funde.some((f) => f.marke === a.marke);
  const jetzt = Date.now();
  // Kopie der wichtigsten Angaben, damit das Heft auch nach Daten-Updates (und Abbau) vollständig bleibt
  S.heft.funde[a.id] = alt || {
    t: jetzt, marke: a.marke, modell: a.modell, typ: a.typ, kw: a.kw, nabe: a.nabe, rotor: a.rotor,
    ibn: a.ibn, ort: a.ort, kreis: a.kreis, land: a.land, park: a.parkKey, lat: a.lat, lon: a.lon,
  };
  if (beruehrt) S.heft.funde[a.id].b = jetzt;
  const neu = pruefeAbzeichen();
  speichereHeft();
  if (navigator.vibrate) navigator.vibrate(beruehrt ? [30, 60, 30] : 30);
  berechneNah();
  renderAlles();
  renderHeft();

  let meldung = neu.length ? neu.map((x) => x.ico + ' ' + x.name).join(' · ')
    : neueMarke ? 'Neue Marke: ' + a.marke + '!'
    : neuesModell ? 'Neues Modell: ' + titel(a) + '!'
    : beruehrt ? '🤚 Turm berührt: ' + titel(a)
    : 'Gesammelt: ' + titel(a);
  if (typeof Online !== 'undefined' && Online.angemeldet()) {
    const r = beruehrt ? await Online.beruehren(a.id, S.pos.lat, S.pos.lon) : await Online.sammeln(a.id, S.pos.lat, S.pos.lon);
    if (r && (r.erstentdecker || r.erstberuehrt)) {
      const f = S.heft.funde[a.id];
      if (r.erstentdecker) f.erst = true;
      if (r.erstberuehrt) f.erstB = true;
      const extra = pruefeAbzeichen();
      speichereHeft();
      renderHeft();
      if (extra.length) meldung += ' · ' + extra.map((x) => x.ico + ' ' + x.name).join(' · ');
    }
    if (r && r.punkte) meldung = '+' + r.punkte + ' Punkte · ' + meldung + (r.erstentdecker ? ' · 🚩 Erstentdecker!' : '') + (r.erstberuehrt ? ' · 🖐️ Erste/r am Turm!' : '');
    else if (r && r.wartend) meldung += ' · wird übertragen, sobald Netz da ist';
    else if (r && r.fehler) meldung += ' · nicht gewertet: ' + r.fehler;
    renderZiel();
  }
  toast(meldung);
}

/* ---------------- Auswertung ---------------- */

const fundTitel = (f) => [f.marke, f.modell || f.typ].filter(Boolean).join(' ') || 'Windenergieanlage';
const fundZeile = (f) => fundTitel(f) + ' · ' + [f.ort, datum(f.t)].filter(Boolean).join(' · ');

function statistik() {
  const funde = Object.entries(S.heft.funde).map(([id, f]) => ({ id, ...f })).sort((a, b) => a.t - b.t);
  const marken = new Map();
  const modelle = new Set();
  const parks = new Map();
  let kw = 0;
  for (const f of funde) {
    if (f.marke) {
      if (!marken.has(f.marke)) marken.set(f.marke, new Map());
      if (f.modell) {
        const m = marken.get(f.marke);
        m.set(f.modell, (m.get(f.modell) || 0) + 1);
        if (!modelle.has(f.marke + '|' + f.modell)) f.neuesModell = true;
        modelle.add(f.marke + '|' + f.modell);
      }
    }
    if (f.park) parks.set(f.park, (parks.get(f.park) || 0) + 1);
    kw += f.kw || 0;
  }
  const parksKomplett = [];
  for (const [p, n] of parks) {
    const gesamt = S.parkAnzahl.get(p) || 0;
    if (gesamt >= 3 && n >= gesamt) parksKomplett.push(p.split('|')[0]);
  }
  const istSelten = (f) => {
    if (!f.modell || !S.d) return false;
    const n = S.modellAnzahl.get(S.d.hersteller.indexOf(f.marke) + '|' + f.modell);
    return n && n <= 20;
  };
  const laender = new Map();
  funde.forEach((f) => { if (f.land) laender.set(f.land, (laender.get(f.land) || 0) + 1); });
  return {
    funde, marken, modelle, kw, parksKomplett, laender,
    selten: funde.filter(istSelten),
    beruehrt: funde.filter((f) => f.b),
    abgebaut: funde.filter((f) => istAbgebaut(f.id)),
  };
}

// Fortschritt je Hersteller: aktive Modelle (≥ AKTIV_MIN an Land in Betrieb) gesammelt?
function herstellerFortschritt(s) {
  const liste = [];
  for (const [marke, modelle] of S.aktivProMarke) {
    const hat = s.marken.get(marke);
    const gesammelt = modelle.filter((m) => hat && hat.has(m.modell));
    liste.push({ marke, modelle, gesammelt, komplett: modelle.length >= 2 && gesammelt.length === modelle.length });
  }
  return liste;
}

/* WEA-Quartette: Sätze von Modellen mit gemeinsamer Eigenschaft.
 * Mitglieder sind alle aktiven Modelle (≥ AKTIV_MIN an Land in Betrieb), auf die der Test passt.
 * Plattform-Zuordnungen nach öffentlich bekannten Herstellerangaben, ohne Gewähr. */
const DIREKTANTRIEB_SIEMENS = /^(SWT3\.0|SWT3\.2|SWT6\.0|SWT7\.0|SVT7\.0|DD\d+|SG8\.0|SG11\.0|SG14|6\.0-154)/;
const QUARTETTE = [
  { k: 'dd', gruppe: 'Plattformen & Technik', ico: '🧲', name: 'Direktantrieb', text: 'Getriebelose Anlagen – Enercon, Vensys, Siemens DD, GE Haliade',
    test: (m) => ['Enercon', 'VENSYS Energy', 'Lagerwey'].includes(m.marke) ||
      (m.marke === 'Siemens Gamesa' && DIREKTANTRIEB_SIEMENS.test(m.modell)) || (m.marke === 'GE' && m.modell === '150-6MW') },
  { k: 'v4', gruppe: 'Plattformen & Technik', ico: '🔷', name: 'Vestas 4-MW-Plattform', text: 'V105 bis V150',
    test: (m) => m.marke === 'Vestas' && ['V105', 'V112', 'V117', 'V126', 'V136', 'V150'].includes(m.modell) },
  { k: 'ep5', gruppe: 'Plattformen & Technik', ico: '🔶', name: 'Enercon EP5 & EP6', text: 'E-147, E-160, E-175',
    test: (m) => m.marke === 'Enercon' && ['E-147', 'E-160', 'E-175'].includes(m.modell) },
  { k: 'delta4000', gruppe: 'Plattformen & Technik', ico: '🔺', name: 'Nordex Delta4000', text: 'N133 bis N175',
    test: (m) => m.marke === 'Nordex' && ['N133', 'N149', 'N155', 'N163', 'N175'].includes(m.modell) },
  { k: 'gamma', gruppe: 'Plattformen & Technik', ico: '🔻', name: 'Nordex Gamma & Delta', text: 'N90, N100, N117, N131',
    test: (m) => m.marke === 'Nordex' && ['N90', 'N100', 'N117', 'N131'].includes(m.modell) },
  ...klassen('leistung', 'Leistungsklassen', '⚡', 'kw', [600, 1500, 2500, 3500, 4500, 5500, 6500, 7500], leistungText),
  ...klassen('rotor', 'Rotordurchmesser', '🌀', 'rotor', [60, 90, 120, 150, 180], (v) => fmt0.format(v) + ' m'),
  ...klassen('nabe', 'Nabenhöhe', '🗼', 'nabe', [50, 100, 130, 160, 180], (v) => fmt0.format(v) + ' m'),
];

// Klassen-Quartette: [unter g0], [g0 bis unter g1], …, [ab gN] – eingeordnet nach dem typischen Wert (Median) des Modells
function klassen(k, gruppe, ico, feld, grenzen, text) {
  const was = { kw: 'Leistung', rotor: 'Rotordurchmesser', nabe: 'Typische Nabenhöhe' }[feld];
  return [...grenzen, Infinity].map((bis, i) => {
    const von = i ? grenzen[i - 1] : 0;
    const name = !von ? 'Unter ' + text(bis) : bis === Infinity ? 'Ab ' + text(von) : text(von) + ' bis ' + text(bis);
    return { k: k + ':' + von, gruppe, ico, name, text: was,
      test: (m) => m[feld] > 0 && m[feld] >= von && m[feld] < bis };
  });
}
function leistungText(kw) { return kw < 1000 ? fmt0.format(kw) + ' kW' : fmt.format(kw / 1000) + ' MW'; }

function quartettStand(q, s) {
  const karten = [...S.katalog.values()].filter(q.test).sort((a, b) => (a.kw || 0) - (b.kw || 0) || b.n - a.n);
  const hat = (m) => s.marken.get(m.marke) && s.marken.get(m.marke).has(m.modell);
  return { karten, hat, gesammelt: karten.filter(hat).length };
}

const ABZEICHEN = [
  { k: 'erster', ico: '🌱', name: 'Erster Fund', text: 'Die erste Anlage', test: (s) => s.funde.length >= 1, belege: (s) => s.funde.slice(0, 1).map(fundZeile) },
  { k: 'a10', ico: '🎯', name: 'Zehnerpack', text: '10 Anlagen', test: (s) => s.funde.length >= 10, belege: (s) => [fundZeile(s.funde[9]) + ' (Nr. 10)'] },
  { k: 'a50', ico: '🏅', name: 'Windjäger', text: '50 Anlagen', test: (s) => s.funde.length >= 50, belege: (s) => [fundZeile(s.funde[49]) + ' (Nr. 50)'] },
  { k: 'a100', ico: '🏆', name: 'Hundertschaft', text: '100 Anlagen', test: (s) => s.funde.length >= 100, belege: (s) => [fundZeile(s.funde[99]) + ' (Nr. 100)'] },
  { k: 'm3', ico: '🏷️', name: 'Markenkenner', text: '3 Hersteller', test: (s) => s.marken.size >= 3, belege: markenBelege },
  { k: 'm6', ico: '🎖️', name: 'Markenprofi', text: '6 Hersteller', test: (s) => s.marken.size >= 6, belege: markenBelege },
  { k: 't10', ico: '🧩', name: 'Typensammler', text: '10 Modelle', test: (s) => s.modelle.size >= 10, belege: modellBelege },
  { k: 't25', ico: '📚', name: 'Typenlexikon', text: '25 Modelle', test: (s) => s.modelle.size >= 25, belege: modellBelege },
  { k: 'alt', ico: '🕰️', name: 'Oldtimer', text: 'Baujahr vor 2000', fund: (f) => f.ibn && f.ibn < '2000' },
  { k: 'riese', ico: '🗼', name: 'Riese', text: 'Nabe ab 160 m', fund: (f) => f.nabe >= 160 },
  { k: 'zwerg', ico: '🐭', name: 'Winzling', text: 'Nabe unter 50 m', fund: (f) => f.nabe && f.nabe < 50 },
  { k: 'kuh', ico: '🐄', name: 'Kuhkratzer', text: 'Blattspitze unter ' + KUHKRATZER + ' m über dem Boden', fund: istKuhkratzer },
  { k: 'selten', ico: '💎', name: 'Rarität', text: 'Modell mit ≤ 20 Anlagen', test: (s) => s.selten.length > 0, belege: (s) => s.selten.map(fundZeile) },
  { k: 'park', ico: '🌬️', name: 'Park komplett', text: 'Alle Anlagen eines Windparks', test: (s) => s.parksKomplett.length > 0, belege: (s) => s.parksKomplett },
  { k: 'mw100', ico: '⚡', name: '100 Megawatt', text: 'Gesammelte Leistung', test: (s) => s.kw >= 100000, belege: (s) => [fmt.format(s.kw / 1000) + ' MW aus ' + s.funde.length + ' Anlagen'] },
  { k: 'land3', ico: '🗺️', name: 'Grenzgänger', text: '3 Bundesländer', test: (s) => s.laender.size >= 3, belege: (s) => [...s.laender].map(([l, n]) => l + ' · ' + n + ' Anlagen') },
  { k: 'b1', ico: '🤚', name: 'Handauflegen', text: 'Einen Turm berührt', test: (s) => s.beruehrt.length >= 1, belege: (s) => s.beruehrt.map(fundZeile) },
  { k: 'b10', ico: '🙌', name: 'Turmstreichler', text: '10 Türme berührt', test: (s) => s.beruehrt.length >= 10, belege: (s) => s.beruehrt.map(fundZeile) },
  { k: 'pionier', ico: '🚩', name: 'Pionier', text: 'Als Erste/r überhaupt entdeckt', fund: (f) => f.erst },
  { k: 'erstkontakt', ico: '🖐️', name: 'Erstkontakt', text: 'Als Erste/r einen Turm berührt', fund: (f) => f.erstB },
  { k: 'zeitzeuge', ico: '🪦', name: 'Zeitzeuge', text: 'Gesammelte Anlage wurde abgebaut', test: (s) => s.abgebaut.length > 0, belege: (s) => s.abgebaut.map(abgebautZeile) },
];
ABZEICHEN.forEach((a) => {
  if (!a.fund) return;
  a.test = (s) => s.funde.some(a.fund);
  a.belege = (s) => s.funde.filter(a.fund).map(fundZeile);
});
function markenBelege(s) { return [...s.marken].map(([m, mod]) => m + ' · ' + mod.size + ' Modell' + (mod.size === 1 ? '' : 'e')); }
function modellBelege(s) { return [...s.marken].flatMap(([m, mod]) => [...mod.keys()].map((x) => m + ' ' + x)); }
function abgebautZeile(f) { return fundTitel(f) + ' · ' + (f.ort || '') + ' · abgebaut ' + (S.abgebaut[f.id] ? datum(S.abgebaut[f.id]) : '(Datum unbekannt)'); }

// Erreichbare Sonderabzeichen: komplette Hersteller und Quartette
function dynamischeAbzeichen(s) {
  const liste = [];
  for (const h of herstellerFortschritt(s)) {
    if (!h.komplett) continue;
    liste.push({ k: 'h:' + h.marke, ico: '🏁', name: h.marke + ' komplett', text: 'Alle aktiven Modelle',
      belege: () => h.modelle.map((m) => h.marke + ' ' + m.modell) });
  }
  for (const q of QUARTETTE) {
    const st = quartettStand(q, s);
    if (st.karten.length < 2 || st.gesammelt < st.karten.length) continue;
    liste.push({ k: 'q:' + q.k, ico: q.ico, name: q.name, text: 'Quartett komplett',
      belege: () => st.karten.map((m) => m.marke + ' ' + m.modell) });
  }
  return liste;
}

function pruefeAbzeichen() {
  const s = statistik();
  const neu = [];
  for (const a of [...ABZEICHEN, ...dynamischeAbzeichen(s)]) {
    if (!S.heft.abzeichen[a.k] && (a.test ? a.test(s) : true)) {
      S.heft.abzeichen[a.k] = Date.now();
      neu.push(a);
    }
  }
  return neu;
}

/* ---------------- Darstellung: Sammelheft ---------------- */

let heftStat = null;
function renderHeft() {
  const s = heftStat = statistik();
  $('#heft-zahlen').innerHTML = [
    [s.funde.length, 'Anlagen'], [s.marken.size, 'Hersteller'], [s.modelle.size, 'Modelle'], [fmt.format(s.kw / 1000), 'MW'],
  ].map(([z, t]) => '<div class="zahl"><b>' + z + '</b><span>' + t + '</span></div>').join('');

  // Abgebaute Anlagen hervorheben – Erinnerungsstücke
  const weg = s.abgebaut;
  $('#heft-abgebaut').hidden = !weg.length;
  if (weg.length) {
    $('#heft-abgebaut').innerHTML = '<div class="zeitzeuge-kopf">🪦 ' + (weg.length === 1 ? 'Eine deiner Anlagen ist' : weg.length + ' deiner Anlagen sind') +
      ' inzwischen abgebaut</div><p class="leise klein">Du hast sie noch gesehen, bevor sie verschwunden ist – ein echtes Erinnerungsstück.</p>' +
      weg.map((f) => '<div class="zeitzeuge-zeile"><b>' + esc(fundTitel(f)) + '</b><span class="leise klein">' +
        esc([f.ort, 'gesammelt ' + datum(f.t), S.abgebaut[f.id] ? 'abgebaut ' + datum(S.abgebaut[f.id]) : null].filter(Boolean).join(' · ')) +
        '</span></div>').join('');
  }

  // Abzeichen: feste + verdiente Sonderabzeichen
  const dyn = dynamischeAbzeichen(s).filter((a) => S.heft.abzeichen[a.k]);
  heftAbzeichen = [...ABZEICHEN, ...dyn];
  $('#heft-abzeichen').innerHTML = heftAbzeichen.map((a, i) => {
    const hat = S.heft.abzeichen[a.k];
    return '<button class="abz' + (hat ? '' : ' zu') + '" data-abz="' + i + '"><div class="ico">' + a.ico + '</div><b>' + esc(a.name) +
      '</b><small>' + (hat ? datum(hat) : esc(a.text)) + '</small></button>';
  }).join('');

  renderVerlauf(s);
  renderHersteller(s);
  renderQuartette(s);
  renderFunde(s);
}
let heftAbzeichen = [];

/* Hersteller: Fortschritt über die aktiven Modelle */
function renderHersteller(s) {
  const liste = herstellerFortschritt(s)
    .filter((h) => h.gesammelt.length || s.marken.has(h.marke))
    .sort((a, b) => b.gesammelt.length / b.modelle.length - a.gesammelt.length / a.modelle.length || b.modelle.length - a.modelle.length);
  const html = liste.map((h) => {
    const sonst = [...(s.marken.get(h.marke) || new Map()).keys()].filter((m) => !h.modelle.some((x) => x.modell === m));
    return '<details class="marke"><summary class="marke-kopf"><span class="marke-name">' + (h.komplett ? '🏁 ' : '') + esc(h.marke) + '</span>' +
      '<span>' + h.gesammelt.length + ' von ' + h.modelle.length + ' aktiven Modellen</span></summary>' +
      balken(h.gesammelt.length, h.modelle.length) +
      '<div class="tags">' + h.modelle.map((m) => {
        const n = s.marken.get(h.marke) && s.marken.get(h.marke).get(m.modell);
        return '<span class="tag' + (n ? ' gesammelt' : ' offen-tag') + '" title="' + fmt0.format(m.n) + ' Anlagen in Betrieb">' +
          (n ? '✓ ' : '') + esc(m.modell) + (n > 1 ? ' ×' + n : '') + '</span>';
      }).join('') + '</div>' +
      (sonst.length ? '<p class="leise klein">Außerdem gesammelt: ' + esc(sonst.join(', ')) + '</p>' : '') +
      '</details>';
  });
  // Marken ohne aktive Modellliste (sehr kleine Hersteller)
  for (const [marke, modelle] of s.marken) {
    if (S.aktivProMarke.has(marke)) continue;
    html.push('<div class="marke"><div class="marke-kopf"><span class="marke-name">' + esc(marke) + '</span><span>' + modelle.size +
      ' Modell' + (modelle.size === 1 ? '' : 'e') + '</span></div><div class="tags">' +
      [...modelle].map(([m, n]) => '<span class="tag gesammelt">✓ ' + esc(m) + (n > 1 ? ' ×' + n : '') + '</span>').join('') + '</div></div>');
  }
  if (S.d) {
    const fehlend = [...S.markeAnzahl.entries()]
      .filter(([h]) => h != null && !s.marken.has(S.d.hersteller[h]))
      .sort((a, b) => b[1] - a[1]).slice(0, 16)
      .map(([h, n]) => '<span class="tag" title="' + fmt0.format(n) + ' Anlagen">' + esc(S.d.hersteller[h]) + '</span>');
    if (fehlend.length) html.push('<p class="leise klein">Noch nicht gefunden:</p><div class="offen">' + fehlend.join('') + '</div>');
  }
  $('#heft-marken').innerHTML = html.join('') || '<div class="karte leise">Noch nichts gesammelt.</div>';
}

function balken(n, gesamt) {
  const p = gesamt ? Math.round(100 * n / gesamt) : 0;
  return '<div class="fortschritt" role="progressbar" aria-valuenow="' + n + '" aria-valuemax="' + gesamt + '"><i style="width:' + p + '%"></i></div>';
}

/* Quartette */
function renderQuartette(s) {
  let gruppe = null;
  $('#heft-quartette').innerHTML = QUARTETTE.map((q, i) => {
    const st = quartettStand(q, s);
    if (st.karten.length < 2) return '';
    const kopf = q.gruppe !== gruppe ? '<h4 class="q-gruppe">' + esc(gruppe = q.gruppe) + '</h4>' : '';
    const fertig = st.gesammelt === st.karten.length;
    return kopf + '<button class="quartett' + (fertig ? ' fertig' : '') + '" data-q="' + i + '"><span class="q-ico">' + q.ico + '</span>' +
      '<span class="q-text"><b>' + esc(q.name) + '</b><small>' + esc(q.text) + '</small>' + balken(st.gesammelt, st.karten.length) + '</span>' +
      '<span class="q-zahl">' + st.gesammelt + '/' + st.karten.length + '</span></button>';
  }).join('');
}

function quartettKarte(m, gesammelt) {
  const werte = [
    ['Leistung', m.kw ? fmt.format(m.kw / 1000) + ' MW' : '–'],
    ['Rotor', m.rotor ? fmt0.format(m.rotor) + ' m' : '–'],
    ['Nabe', m.nabe ? fmt0.format(m.nabe) + ' m' + (m.nabeMax > m.nabeMin ? ' (' + fmt0.format(m.nabeMin) + '–' + fmt0.format(m.nabeMax) + ')' : '') : '–'],
    ['Bestand', fmt0.format(m.n)],
    ['Seit', m.ibn ? m.ibn.slice(0, 4) : '–'],
  ];
  return '<div class="qkarte' + (gesammelt ? ' hat' : '') + '"><div class="qk-kopf"><small>' + esc(m.marke) + '</small><b>' + esc(m.modell) + '</b>' +
    '<span class="qk-status">' + (gesammelt ? '✓' : '?') + '</span></div>' +
    werte.map(([k, v]) => '<div class="qk-zeile"><span>' + k + '</span><b>' + v + '</b></div>').join('') + '</div>';
}

$('#heft-quartette').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-q]');
  if (!b) return;
  const q = QUARTETTE[+b.dataset.q];
  const st = quartettStand(q, heftStat || statistik());
  zeigeSheet(q.ico + ' ' + q.name,
    '<p class="leise">' + esc(q.text) + ' · ' + st.gesammelt + ' von ' + st.karten.length + ' gesammelt</p>' +
    '<div class="qkarten">' + st.karten.map((m) => quartettKarte(m, st.hat(m))).join('') + '</div>' +
    '<p class="leise klein">Typische Werte (Median) der Anlagen an Land in Betrieb, Nabenhöhe mit Spanne (Marktstammdatenregister). Plattform-Zuordnung ohne Gewähr.</p>');
});

$('#heft-abzeichen').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-abz]');
  if (!b) return;
  const a = heftAbzeichen[+b.dataset.abz];
  const hat = S.heft.abzeichen[a.k];
  const s = heftStat || statistik();
  const belege = (a.test ? a.test(s) : true) && a.belege ? a.belege(s) : [];
  const max = 40;
  zeigeSheet(a.ico + ' ' + a.name,
    '<p>' + esc(a.text) + '</p>' +
    '<p class="leise klein">' + (hat ? 'Erhalten am ' + datum(hat) : 'Noch nicht erreicht') + '</p>' +
    (belege.length ? '<h4 class="sheet-unter">Dafür gezählt</h4><ul class="belege">' +
      belege.slice(0, max).map((x) => '<li>' + esc(x) + '</li>').join('') +
      (belege.length > max ? '<li class="leise">… und ' + (belege.length - max) + ' weitere</li>' : '') + '</ul>' : ''));
});

/* Persönlicher Verlauf: je Monat oder Jahr */
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONATE_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function perioden(s) {
  const jetzt = new Date();
  const liste = [];
  if (S.verlauf.art === 'monat') {
    for (let k = 11; k >= 0; k--) {
      const d = new Date(jetzt.getFullYear(), jetzt.getMonth() - k, 1);
      liste.push({ key: d.getFullYear() + '-' + d.getMonth(), kurz: MONATE[d.getMonth()], lang: MONATE_LANG[d.getMonth()] + ' ' + d.getFullYear() });
    }
  } else {
    const erstes = s.funde.length ? new Date(s.funde[0].t).getFullYear() : jetzt.getFullYear();
    for (let j = Math.max(erstes, jetzt.getFullYear() - 9); j <= jetzt.getFullYear(); j++) liste.push({ key: '' + j, kurz: '' + j, lang: 'Jahr ' + j });
  }
  const index = new Map(liste.map((p) => [p.key, Object.assign(p, { anlagen: 0, modelle: 0, kw: 0, beruehrt: 0 })]));
  for (const f of s.funde) {
    const d = new Date(f.t);
    const p = index.get(S.verlauf.art === 'monat' ? d.getFullYear() + '-' + d.getMonth() : '' + d.getFullYear());
    if (!p) continue;
    p.anlagen++;
    p.kw += f.kw || 0;
    if (f.neuesModell) p.modelle++;
    if (f.b) p.beruehrt++;
  }
  return liste;
}

function renderVerlauf(s) {
  const liste = perioden(s);
  const art = S.verlauf.wert;
  const wert = (p) => (art === 'kw' ? p.kw / 1000 : p[art]);
  const max = Math.max(...liste.map(wert), 0);
  if (!liste.some((p) => p.key === S.verlauf.sel)) S.verlauf.sel = liste[liste.length - 1].key;
  const sel = liste.find((p) => p.key === S.verlauf.sel);
  const einheit = { anlagen: 'Anlagen', modelle: 'neue Modelle', kw: 'MW' }[art];

  $('#verlauf-balken').innerHTML = liste.map((p) => {
    const v = wert(p);
    const h = max ? Math.max(v ? 3 : 0, Math.round(100 * v / max)) : 0;
    return '<button class="vb' + (p.key === sel.key ? ' an' : '') + '" data-p="' + p.key + '" aria-label="' + esc(p.lang + ': ' + fmt.format(v) + ' ' + einheit) + '">' +
      '<span class="vb-saeule"><i style="height:' + h + '%"></i></span><small>' + p.kurz + '</small></button>';
  }).join('');
  $('#verlauf-max').textContent = max ? fmt.format(max) + ' ' + einheit : '';
  $('#verlauf-auswertung').innerHTML = '<div class="va-titel">' + esc(sel.lang) + '</div><div class="zahlen">' + [
    [sel.anlagen, 'Anlagen'], [sel.modelle, 'neue Modelle'], [fmt.format(sel.kw / 1000), 'MW'], [sel.beruehrt, 'berührt'],
  ].map(([z, t]) => '<div class="zahl"><b>' + z + '</b><span>' + t + '</span></div>').join('') + '</div>';
}

$('#verlauf-art').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-art]');
  if (!b) return;
  S.verlauf.art = b.dataset.art;
  S.verlauf.sel = null;
  document.querySelectorAll('#verlauf-art button').forEach((x) => x.classList.toggle('an', x === b));
  renderVerlauf(heftStat || statistik());
});
$('#verlauf-wert').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-wert]');
  if (!b) return;
  S.verlauf.wert = b.dataset.wert;
  document.querySelectorAll('#verlauf-wert button').forEach((x) => x.classList.toggle('an', x === b));
  renderVerlauf(heftStat || statistik());
});
$('#verlauf-balken').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-p]');
  if (!b) return;
  S.verlauf.sel = b.dataset.p;
  renderVerlauf(heftStat || statistik());
});

/* Funde als Liste */
function renderFunde(s) {
  const filter = { alle: () => true, beruehrt: (f) => f.b, abgebaut: (f) => istAbgebaut(f.id) }[S.fundFilter];
  const funde = s.funde.filter(filter).sort((a, b) => b.t - a.t);
  document.querySelectorAll('#funde-filter button').forEach((b) => {
    const n = { alle: s.funde.length, beruehrt: s.beruehrt.length, abgebaut: s.abgebaut.length }[b.dataset.f];
    b.querySelector('small').textContent = n;
    b.hidden = b.dataset.f !== 'alle' && !n;
  });
  $('#heft-funde').innerHTML = funde.length
    ? funde.map((f) => {
      const weg = istAbgebaut(f.id);
      return '<li data-id="' + esc(f.id) + '"' + (weg ? ' class="abgebaut"' : '') + '><span class="li-pfeil">' + (weg ? '🪦' : f.b ? '🤚' : '★') + '</span>' +
        '<span class="li-text"><div class="li-titel">' + esc(fundTitel(f)) + '</div><div class="li-unter">' +
        esc([weg ? 'abgebaut' + (S.abgebaut[f.id] ? ' ' + datum(S.abgebaut[f.id]) : '') : null, f.erst ? '🚩 Erstentdeckung' : null,
          f.erstB ? '🖐️ zuerst berührt' : null, f.ort, f.kreis].filter(Boolean).join(' · ')) +
        '</div></span><span class="li-dist">' + datum(f.t) + '</span></li>';
    }).join('')
    : S.fundFilter === 'alle'
      ? '<li class="leer">Geh in die Nähe einer Anlage (unter ' + SAMMEL_RADIUS + ' m) und tippe auf „Sammeln“.</li>'
      : '<li class="leer">Keine Funde in dieser Auswahl.</li>';
  $('#btn-funde-karte').hidden = !s.funde.length;
}

$('#funde-filter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-f]');
  if (!b) return;
  S.fundFilter = b.dataset.f;
  document.querySelectorAll('#funde-filter button').forEach((x) => x.classList.toggle('an', x === b));
  renderFunde(heftStat || statistik());
});

$('#btn-funde-karte').addEventListener('click', () => {
  zeigeView('naehe');
  vollbild(true);
  setTimeout(() => zeigeFundeAufKarte(true), 60);
});

$('#heft-funde').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const id = li.dataset.id;
  const f = S.heft.funde[id];
  const i = S.idIndex.get(id);
  zeigeView('naehe');
  if (i != null && S.pos) return waehle(i, true);
  // ohne Standort oder abgebaut: auf der Karte zeigen
  if (f.lat == null) return toast('Für diese Anlage ist kein Standort gespeichert');
  if (!S.fundeAufKarte) zeigeFundeAufKarte(true);
  setTimeout(() => {
    S.map.setView([f.lat, f.lon], 15);
    L.popup().setLatLng([f.lat, f.lon]).setContent(fundPopup(id, f)).openOn(S.map);
  }, 60);
});

/* ---------------- Detailansicht (Sheet) ---------------- */

function zeigeSheet(titelText, html) {
  $('#sheet-titel').textContent = titelText;
  $('#sheet-inhalt').innerHTML = html;
  const dlg = $('#sheet');
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}
$('#sheet-zu').addEventListener('click', () => $('#sheet').close());
$('#sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

/* ---------------- Sicherung ---------------- */

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(S.heft, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'windsammler-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#inp-import').addEventListener('change', async (e) => {
  const datei = e.target.files[0];
  if (!datei) return;
  try {
    const h = JSON.parse(await datei.text());
    if (!h || typeof h.funde !== 'object') throw new Error();
    // zusammenführen statt überschreiben – ältere Funde bleiben erhalten
    S.heft.funde = { ...h.funde, ...S.heft.funde };
    S.heft.abzeichen = { ...(h.abzeichen || {}), ...S.heft.abzeichen };
    if (S.d) aktualisiereHeft();
    pruefeAbzeichen();
    speichereHeft();
    renderHeft();
    toast(Object.keys(h.funde).length + ' Funde importiert');
  } catch (_) {
    toast('Datei ist kein Windsammler-Export');
  }
  e.target.value = '';
});

/* ---------------- Navigation & Hilfen ---------------- */

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) zeigeView(b.dataset.view);
});

function zeigeView(v) {
  if (istVollbild()) vollbild(false);
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('an', b.dataset.view === v));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('aktiv', s.id === 'view-' + v));
  if (v === 'heft') renderHeft();
  if (v === 'rang' && typeof Online !== 'undefined') Online.zeigen();
  if (v === 'naehe' && S.map) setTimeout(() => S.map.invalidateSize(), 0);
  window.scrollTo(0, 0);
}

function status(t) { $('#status').textContent = t; }

let toastTimer;
function toast(t) {
  const el = $('#toast');
  el.textContent = t;
  el.classList.add('zeigen');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('zeigen'), 2800);
}

function datum(x) {
  if (!x) return '';
  const d = typeof x === 'number' ? new Date(x) : new Date(x.length === 10 ? x + 'T00:00:00' : x);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Übernimmt eine neue Fassung (neue VERSION in sw.js), einmal neu laden – sonst sieht man sie erst beim übernächsten Öffnen.
  // Beim allerersten Besuch gibt es noch keinen controller, dann nicht neu laden.
  if (navigator.serviceWorker.controller) {
    let neuGeladen = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (neuGeladen) return;
      neuGeladen = true;
      location.reload();
    });
  }
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
