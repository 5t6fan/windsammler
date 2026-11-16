'use strict';
/* Windsammler – Windenergieanlagen in der Nähe finden und sammeln.
 *
 * Test am Rechner (ohne GPS):  index.html?pos=51.2700,9.7394   feste Position
 *                              index.html?pos=…&test           Sammeln ohne Entfernungsgrenze
 */

const PARAM = new URLSearchParams(location.search);
const TESTMODUS = PARAM.has('test');
const SAMMEL_RADIUS = TESTMODUS ? Infinity : 300;   // Meter
const LISTE_MAX = 50;
const SPEICHER = 'windsammler.v1';

const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const fmt0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

const S = {
  d: null, F: null, n: 0, lat: null, lon: null,
  idIndex: new Map(), modellAnzahl: new Map(), parkAnzahl: new Map(), markeAnzahl: new Map(),
  planungIdx: -1,
  pos: null, heading: null, radius: 5000, planung: false,
  sel: null, manuell: false, nah: [], naechste: null,
  heft: ladeHeft(),
  map: null, layer: null, ich: null, linie: null, ersterFix: true,
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
  const F = S.F;
  d.anlagen.forEach((z, i) => {
    S.lat[i] = z[F.lat];
    S.lon[i] = z[F.lon];
    S.idIndex.set(z[F.id], i);
    if (z[F.status] === S.planungIdx) return;
    zaehle(S.markeAnzahl, z[F.hersteller]);
    if (z[F.modell]) zaehle(S.modellAnzahl, z[F.hersteller] + '|' + z[F.modell]);
    if (z[F.park]) zaehle(S.parkAnzahl, parkKey(z));
  });
  status(fmt0.format(S.n) + ' Anlagen · Stand ' + datum(d.meta.datenstand));
  $('#quelle').textContent = 'Daten: ' + d.meta.quelle + ', Stand ' + datum(d.meta.datenstand) + '.';
  $('#btn-start').disabled = false;
  initKarte();
  renderHeft();
  if (location.hash === '#heft' || location.hash === '#rang') zeigeView(location.hash.slice(1));
  if (PARAM.has('karte')) vollbild(true);

  const p = PARAM.get('pos');
  if (p) {
    const [la, lo] = p.split(',').map(Number);
    if (isFinite(la) && isFinite(lo)) neuePosition({ lat: la, lon: lo, acc: 5 });
  }
}

function zaehle(map, key) { map.set(key, (map.get(key) || 0) + 1); }
function parkKey(z) { return z[S.F.park] + '|' + z[S.F.kreis]; }

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
  const dLat = S.radius / 111320;
  const nah = [];
  let best = null, bestD = Infinity;
  for (let i = 0; i < S.n; i++) {
    if (!S.planung && S.d.anlagen[i][S.F.status] === S.planungIdx) continue;
    const grob = Math.abs(S.lat[i] - lat);
    if (grob > dLat && grob * 111320 > bestD) continue;
    const d = distanz(lat, lon, S.lat[i], S.lon[i]);
    if (d < bestD) { bestD = d; best = i; }
    if (d <= S.radius) nah.push({ i, d });
  }
  nah.sort((a, b) => a.d - b.d);
  S.nah = nah;
  S.naechste = best;
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
  const gesammelt = !!S.heft.funde[a.id];

  $('#ziel-label').textContent = S.manuell && S.sel !== S.naechste ? 'Ausgewählte Anlage' : 'Nächste Anlage';
  $('#ziel-dist').textContent = entfernung(d);
  $('#ziel-richtung').textContent = 'Richtung ' + RICHTUNGEN[sektor(b)] + ' (' + fmt0.format(b) + '°)';
  $('#ziel-titel').textContent = titel(a);
  $('#ziel-ort').textContent = [a.park || a.name, a.ort, a.kreis].filter(Boolean).join(' · ');
  $('#ziel-text').textContent = beschreibung(a);
  $('#ziel-tags').innerHTML = tags(a, gesammelt);

  const knopf = $('#btn-sammeln');
  if (gesammelt) {
    knopf.disabled = true;
    knopf.textContent = '✓ Gesammelt am ' + datum(S.heft.funde[a.id].t);
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
  $('#btn-naechste').hidden = !(S.manuell && S.sel !== S.naechste);
  $('#map-info-dist').textContent = entfernung(d) + ' ' + KURZ[sektor(b)] + (gesammelt ? ' ✓' : '');
  $('#map-info-titel').textContent = titel(a) + (a.park ? ' · ' + a.park : '');
  S.zielPeilung = b;
  drehePfeil();
  zeigeEntdecker(a.id);
}

// Erster Finder in meinen Gruppen (nur mit Rangliste)
async function zeigeEntdecker(id) {
  const el = $('#ziel-entdecker');
  if (typeof Online === 'undefined' || !Online.angemeldet()) { el.hidden = true; return; }
  const e = await Online.entdecker(id);
  if (S.sel == null || anlage(S.sel).id !== id) return;  // inzwischen andere Anlage gewählt
  el.hidden = !e;
  if (e) el.textContent = '🚩 Erstentdeckt von ' + (e.ich ? 'dir' : e.name) + ' am ' + datum(Date.parse(e.zeit));
}

function drehePfeil() {
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

function beschreibung(a) {
  const s = [];
  if (a.kw) s.push('Leistung ' + fmt.format(a.kw / 1000) + ' MW.');
  if (a.nabe && a.rotor) {
    s.push('Nabenhöhe ' + fmt0.format(a.nabe) + ' m, Rotordurchmesser ' + fmt0.format(a.rotor) +
      ' m – mit Blattspitze rund ' + fmt0.format(a.nabe + a.rotor / 2) + ' m hoch.');
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
  return s.join(' ');
}

function tags(a, gesammelt) {
  const t = [];
  if (gesammelt) t.push('<span class="tag gesammelt">✓ gesammelt</span>');
  if (a.planung) t.push('<span class="tag planung">in Planung</span>');
  else if (a.status !== 'In Betrieb') t.push('<span class="tag planung">' + esc(a.status) + '</span>');
  if (a.see) t.push('<span class="tag">offshore</span>');
  const n = a.modell && S.modellAnzahl.get(a.markeIdx + '|' + a.modell);
  if (n && n <= 20) t.push('<span class="tag selten">💎 selten</span>');
  if (a.ibn && a.ibn < '2000' && !a.planung) t.push('<span class="tag">🕰️ Oldtimer</span>');
  if (a.nabe >= 160) t.push('<span class="tag">🗼 Riese</span>');
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
    const haken = S.heft.funde[a.id] ? ' ✓' : '';
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

function initKarte() {
  S.map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([51.2, 10.4], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(S.map);
  S.layer = L.layerGroup().addTo(S.map);
}

function farbe(a, gewaehlt) {
  if (gewaehlt) return '#e0452b';
  if (S.heft.funde[a.id]) return '#c58b12';
  return a.planung ? '#8a8f99' : '#0e6b58';
}

function renderKarte() {
  if (!S.map || !S.pos) return;
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
    L.polyline([[lat, lon], [S.lat[S.sel], S.lon[S.sel]]], { color: '#e0452b', weight: 3, dashArray: '6 8', opacity: 0.8 }).addTo(S.layer);
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

function zentriere() {
  if (!S.pos) return;
  const punkte = [[S.pos.lat, S.pos.lon]];
  if (S.sel != null) punkte.push([S.lat[S.sel], S.lon[S.sel]]);
  S.nah.slice(0, 8).forEach(({ i }) => punkte.push([S.lat[i], S.lon[i]]));
  S.map.fitBounds(punkte, { padding: [40, 40], maxZoom: 15 });
}
$('#btn-zentrieren').addEventListener('click', zentriere);

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
  if (S.pos) { berechneNah(); renderAlles(); zentriere(); }
});

$('#chk-planung').addEventListener('change', (e) => {
  S.planung = e.target.checked;
  if (S.pos) { berechneNah(); renderAlles(); }
});

/* ---------------- Sammeln ---------------- */

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

$('#btn-sammeln').addEventListener('click', async () => {
  if (S.sel == null || !S.pos) return;
  const a = anlage(S.sel);
  const d = distanz(S.pos.lat, S.pos.lon, a.lat, a.lon);
  if (a.planung || d > SAMMEL_RADIUS || S.heft.funde[a.id]) return;
  const neuesModell = a.modell && !Object.values(S.heft.funde).some((f) => f.marke === a.marke && f.modell === a.modell);
  const neueMarke = a.marke && !Object.values(S.heft.funde).some((f) => f.marke === a.marke);
  // Kopie der wichtigsten Angaben, damit das Heft auch nach Daten-Updates vollständig bleibt
  S.heft.funde[a.id] = {
    t: Date.now(), marke: a.marke, modell: a.modell, typ: a.typ, kw: a.kw, nabe: a.nabe,
    ibn: a.ibn, ort: a.ort, kreis: a.kreis, land: a.land, park: a.parkKey,
  };
  const neu = pruefeAbzeichen();
  speichereHeft();
  if (navigator.vibrate) navigator.vibrate(30);
  renderAlles();
  renderHeft();

  let meldung = neu.length ? neu.map((x) => x.ico + ' ' + x.name).join(' · ')
    : neueMarke ? 'Neue Marke: ' + a.marke + '!'
    : neuesModell ? 'Neues Modell: ' + titel(a) + '!'
    : 'Gesammelt: ' + titel(a);
  if (typeof Online !== 'undefined' && Online.angemeldet()) {
    const r = await Online.sammeln(a.id, S.pos.lat, S.pos.lon);
    if (r && r.punkte) meldung = '+' + r.punkte + ' Punkte · ' + meldung + (r.erstentdecker ? ' · Erstentdecker!' : '');
    else if (r && r.wartend) meldung += ' · wird übertragen, sobald Netz da ist';
    else if (r && r.fehler) meldung += ' · nicht gewertet: ' + r.fehler;
    renderZiel();
  }
  toast(meldung);
});

function statistik() {
  const funde = Object.entries(S.heft.funde).map(([id, f]) => ({ id, ...f }));
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
        modelle.add(f.marke + '|' + f.modell);
      }
    }
    if (f.park) parks.set(f.park, (parks.get(f.park) || 0) + 1);
    kw += f.kw || 0;
  }
  let parksKomplett = 0;
  for (const [p, n] of parks) {
    const gesamt = S.parkAnzahl.get(p) || 0;
    if (gesamt >= 3 && n >= gesamt) parksKomplett++;
  }
  const selten = funde.some((f) => {
    if (!f.modell) return false;
    const idx = S.d ? S.d.hersteller.indexOf(f.marke) : -1;
    const n = S.modellAnzahl.get(idx + '|' + f.modell);
    return n && n <= 20;
  });
  return {
    funde, marken, modelle, kw, parksKomplett, selten,
    laender: new Set(funde.map((f) => f.land).filter(Boolean)),
  };
}

const ABZEICHEN = [
  { k: 'erster', ico: '🌱', name: 'Erster Fund', text: 'Die erste Anlage', test: (s) => s.funde.length >= 1 },
  { k: 'a10', ico: '🎯', name: 'Zehnerpack', text: '10 Anlagen', test: (s) => s.funde.length >= 10 },
  { k: 'a50', ico: '🏅', name: 'Windjäger', text: '50 Anlagen', test: (s) => s.funde.length >= 50 },
  { k: 'a100', ico: '🏆', name: 'Hundertschaft', text: '100 Anlagen', test: (s) => s.funde.length >= 100 },
  { k: 'm3', ico: '🏷️', name: 'Markenkenner', text: '3 Hersteller', test: (s) => s.marken.size >= 3 },
  { k: 'm6', ico: '🎖️', name: 'Markenprofi', text: '6 Hersteller', test: (s) => s.marken.size >= 6 },
  { k: 't10', ico: '🧩', name: 'Typensammler', text: '10 Modelle', test: (s) => s.modelle.size >= 10 },
  { k: 't25', ico: '📚', name: 'Typenlexikon', text: '25 Modelle', test: (s) => s.modelle.size >= 25 },
  { k: 'alt', ico: '🕰️', name: 'Oldtimer', text: 'Baujahr vor 2000', test: (s) => s.funde.some((f) => f.ibn && f.ibn < '2000') },
  { k: 'riese', ico: '🗼', name: 'Riese', text: 'Nabe ab 160 m', test: (s) => s.funde.some((f) => f.nabe >= 160) },
  { k: 'zwerg', ico: '🐭', name: 'Winzling', text: 'Nabe unter 50 m', test: (s) => s.funde.some((f) => f.nabe && f.nabe < 50) },
  { k: 'selten', ico: '💎', name: 'Rarität', text: 'Modell mit ≤ 20 Anlagen', test: (s) => s.selten },
  { k: 'park', ico: '🌬️', name: 'Park komplett', text: 'Alle Anlagen eines Windparks', test: (s) => s.parksKomplett > 0 },
  { k: 'mw100', ico: '⚡', name: '100 Megawatt', text: 'Gesammelte Leistung', test: (s) => s.kw >= 100000 },
  { k: 'land3', ico: '🗺️', name: 'Grenzgänger', text: '3 Bundesländer', test: (s) => s.laender.size >= 3 },
];

function pruefeAbzeichen() {
  const s = statistik();
  const neu = [];
  for (const a of ABZEICHEN) {
    if (!S.heft.abzeichen[a.k] && a.test(s)) {
      S.heft.abzeichen[a.k] = Date.now();
      neu.push(a);
    }
  }
  return neu;
}

/* ---------------- Darstellung: Sammelheft ---------------- */

function renderHeft() {
  const s = statistik();
  $('#heft-zahlen').innerHTML = [
    [s.funde.length, 'Anlagen'], [s.marken.size, 'Hersteller'], [s.modelle.size, 'Modelle'], [fmt.format(s.kw / 1000), 'MW'],
  ].map(([z, t]) => '<div class="zahl"><b>' + z + '</b><span>' + t + '</span></div>').join('');

  $('#heft-abzeichen').innerHTML = ABZEICHEN.map((a) => {
    const hat = S.heft.abzeichen[a.k];
    return '<div class="abz' + (hat ? '' : ' zu') + '"><div class="ico">' + a.ico + '</div><b>' + esc(a.name) +
      '</b><small>' + (hat ? datum(hat) : esc(a.text)) + '</small></div>';
  }).join('');

  // Gefundene Marken mit ihren Modellen, darunter die noch fehlenden großen Marken
  const html = [];
  const markenSortiert = [...s.marken.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  for (const [marke, modelle] of markenSortiert) {
    const idx = S.d ? S.d.hersteller.indexOf(marke) : -1;
    const verfuegbar = idx >= 0 ? [...S.modellAnzahl.keys()].filter((k) => k.startsWith(idx + '|') && S.modellAnzahl.get(k) >= 5).length : 0;
    html.push('<div class="marke"><div class="marke-kopf">' + esc(marke) + '<span>' + modelle.size + ' Modell' +
      (modelle.size === 1 ? '' : 'e') + (verfuegbar ? ' von ~' + verfuegbar : '') + '</span></div><div class="tags">' +
      [...modelle.entries()].map(([m, n]) => '<span class="tag">' + esc(m) + (n > 1 ? ' ×' + n : '') + '</span>').join('') +
      '</div></div>');
  }
  if (S.d) {
    const fehlend = [...S.markeAnzahl.entries()]
      .filter(([h]) => h != null && !s.marken.has(S.d.hersteller[h]))
      .sort((a, b) => b[1] - a[1]).slice(0, 16)
      .map(([h, n]) => '<span class="tag" title="' + fmt0.format(n) + ' Anlagen">' + esc(S.d.hersteller[h]) + '</span>');
    if (fehlend.length) html.push('<p class="leise klein">Noch nicht gefunden:</p><div class="offen">' + fehlend.join('') + '</div>');
  }
  $('#heft-marken').innerHTML = html.join('') || '<div class="karte leise">Noch nichts gesammelt.</div>';

  const funde = s.funde.sort((a, b) => b.t - a.t);
  $('#heft-funde').innerHTML = funde.length
    ? funde.map((f) => '<li data-id="' + esc(f.id) + '"><span class="li-pfeil">★</span><span class="li-text"><div class="li-titel">' +
        esc([f.marke, f.modell || f.typ].filter(Boolean).join(' ') || 'Windenergieanlage') + '</div><div class="li-unter">' +
        esc([f.ort, f.kreis].filter(Boolean).join(' · ')) + '</div></span><span class="li-dist">' + datum(f.t) + '</span></li>').join('')
    : '<li class="leer">Geh in die Nähe einer Anlage (unter ' + SAMMEL_RADIUS + ' m) und tippe auf „Sammeln“.</li>';
}

$('#heft-funde').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const i = S.idIndex.get(li.dataset.id);
  if (i == null) return;
  zeigeView('naehe');
  if (S.pos) waehle(i, true);
  else S.map.setView([S.lat[i], S.lon[i]], 14);
});

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
  const d = typeof x === 'number' ? new Date(x) : new Date(x + 'T00:00:00');
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
