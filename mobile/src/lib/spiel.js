// Spielregeln: Statistik, Abzeichen, Hersteller-Fortschritt, Quartette, Verlauf.
// Entspricht der Logik in web/app.js, aber ohne DOM.
import { fmt, fmt0, datum, MONATE, MONATE_LANG } from './format';

export const SAMMEL_RADIUS = 300;   // Meter
export const BERUEHR_RADIUS = 20;   // Meter – „Turm berührt“
export const KUHKRATZER = 20;       // Meter – untere Blattspitze näher am Boden als das: „Kuhkratzer“

// Abstand der unteren Blattspitze zum Boden (Nabenhöhe minus halber Rotordurchmesser)
export const freiraum = (a) => (a.nabe && a.rotor ? a.nabe - a.rotor / 2 : null);
export const istKuhkratzer = (a) => { const f = freiraum(a); return f != null && f < KUHKRATZER; };

export const istAbgebaut = (D, id) => !!D && !D.idIndex.has(id);
export const fundTitel = (f) => [f.marke, f.modell || f.typ].filter(Boolean).join(' ') || 'Windenergieanlage';
export const fundZeile = (f) => fundTitel(f) + ' · ' + [f.ort, datum(f.t)].filter(Boolean).join(' · ');

export function titel(a) {
  const modell = a.modell || a.typ;
  if (a.marke && modell) return a.marke + ' ' + modell;
  return a.marke || modell || 'Windenergieanlage';
}

// Funde an den aktuellen Datenstand anpassen (Koordinaten, sauberere Modellnamen). Gibt true bei Änderung.
export function aktualisiereHeft(D, heft, anlage) {
  let geaendert = false;
  for (const [id, f] of Object.entries(heft.funde)) {
    const i = D.idIndex.get(id);
    if (i == null) continue;
    const a = anlage(D, i);
    const neu = { lat: a.lat, lon: a.lon, marke: a.marke, modell: a.modell, rotor: a.rotor };
    for (const [k, v] of Object.entries(neu)) {
      if (v != null && f[k] !== v) { f[k] = v; geaendert = true; }
    }
  }
  return geaendert;
}

/* ---------------- Beschreibung der Zielanlage ---------------- */

// „Rotordurchmesser 90 m bis 120 m“ statt nur „90 m bis 120 m“; Plattformen behalten ihren Namen
function quartettLabel(q) {
  return q.gruppe === 'Plattformen & Technik' ? q.name : q.text + ' ' + q.name.charAt(0).toLowerCase() + q.name.slice(1);
}

export function beschreibung(D, a) {
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
  const n = a.modell && D.modellAnzahl.get(a.markeIdx + '|' + a.modell);
  if (n) {
    s.push(n <= 20
      ? 'Selten: nur ' + n + (n === 1 ? ' Anlage' : ' Anlagen') + ' dieses Modells in Deutschland.'
      : 'Eine von ' + fmt0.format(n) + ' Anlagen dieses Modells in Deutschland.');
  }
  const m = a.marke && D.katalog.get(a.marke + '|' + a.modell);
  const q = m ? QUARTETTE.filter((x) => x.test(m)) : [];
  if (q.length) s.push('Quartette: ' + q.map(quartettLabel).join(', ') + '.');
  return s.join(' ');
}

// Etiketten: { text, art } mit art = gesammelt | planung | selten | normal
export function etiketten(D, a, fund) {
  const t = [];
  if (fund) t.push({ text: '✓ gesammelt', art: 'gesammelt' });
  if (fund && fund.b) t.push({ text: '🤚 berührt', art: 'gesammelt' });
  if (a.planung) t.push({ text: 'in Planung', art: 'planung' });
  else if (a.status !== 'In Betrieb') t.push({ text: a.status, art: 'planung' });
  if (a.see) t.push({ text: 'offshore', art: 'normal' });
  const n = a.modell && D.modellAnzahl.get(a.markeIdx + '|' + a.modell);
  if (n && n <= 20) t.push({ text: '💎 selten', art: 'selten' });
  if (a.ibn && a.ibn < '2000' && !a.planung) t.push({ text: '🕰️ Oldtimer', art: 'normal' });
  if (a.nabe >= 160) t.push({ text: '🗼 Riese', art: 'normal' });
  if (istKuhkratzer(a)) t.push({ text: '🐄 Kuhkratzer', art: 'normal' });
  return t;
}

/* ---------------- Statistik ---------------- */

export function statistik(D, heft) {
  const funde = Object.entries(heft.funde).map(([id, f]) => ({ id, ...f })).sort((a, b) => a.t - b.t);
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
    const gesamt = (D && D.parkAnzahl.get(p)) || 0;
    if (gesamt >= 3 && n >= gesamt) parksKomplett.push(p.split('|')[0]);
  }
  const istSelten = (f) => {
    if (!f.modell || !D) return false;
    const n = D.modellAnzahl.get(D.hersteller.indexOf(f.marke) + '|' + f.modell);
    return n && n <= 20;
  };
  const laender = new Map();
  funde.forEach((f) => { if (f.land) laender.set(f.land, (laender.get(f.land) || 0) + 1); });
  return {
    funde, marken, modelle, kw, parksKomplett, laender,
    selten: funde.filter(istSelten),
    beruehrt: funde.filter((f) => f.b),
    abgebaut: funde.filter((f) => istAbgebaut(D, f.id)),
  };
}

// Fortschritt je Hersteller über die aktiven Modelle
export function herstellerFortschritt(D, s) {
  const liste = [];
  for (const [marke, modelle] of D.aktivProMarke) {
    const hat = s.marken.get(marke);
    const gesammelt = modelle.filter((m) => hat && hat.has(m.modell));
    liste.push({ marke, modelle, gesammelt, komplett: modelle.length >= 2 && gesammelt.length === modelle.length });
  }
  return liste;
}

/* ---------------- Quartette ---------------- */
// Plattform-Zuordnungen nach öffentlich bekannten Herstellerangaben, ohne Gewähr.

const DIREKTANTRIEB_SIEMENS = /^(SWT3\.0|SWT3\.2|SWT6\.0|SWT7\.0|SVT7\.0|DD\d+|SG8\.0|SG11\.0|SG14|6\.0-154)/;

function leistungText(kw) { return kw < 1000 ? fmt0.format(kw) + ' kW' : fmt.format(kw / 1000) + ' MW'; }
const meter = (v) => fmt0.format(v) + ' m';

// Klassen: [unter g0], [g0 bis unter g1], …, [ab gN] – nach dem typischen Wert (Median) des Modells
function klassen(k, gruppe, ico, feld, grenzen, text) {
  const was = { kw: 'Leistung', rotor: 'Rotordurchmesser', nabe: 'Typische Nabenhöhe' }[feld];
  return [...grenzen, Infinity].map((bis, i) => {
    const von = i ? grenzen[i - 1] : 0;
    const name = !von ? 'Unter ' + text(bis) : bis === Infinity ? 'Ab ' + text(von) : text(von) + ' bis ' + text(bis);
    return { k: k + ':' + von, gruppe, ico, name, text: was, test: (m) => m[feld] > 0 && m[feld] >= von && m[feld] < bis };
  });
}

export const QUARTETTE = [
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
  ...klassen('rotor', 'Rotordurchmesser', '🌀', 'rotor', [60, 90, 120, 150, 180], meter),
  ...klassen('nabe', 'Nabenhöhe', '🗼', 'nabe', [50, 100, 130, 160, 180], meter),
];

export function quartettStand(D, q, s) {
  const karten = [...D.katalog.values()].filter(q.test).sort((a, b) => (a.kw || 0) - (b.kw || 0) || b.n - a.n);
  const hat = (m) => !!(s.marken.get(m.marke) && s.marken.get(m.marke).has(m.modell));
  return { karten, hat, gesammelt: karten.filter(hat).length };
}

/* ---------------- Abzeichen ---------------- */

const markenBelege = (s) => [...s.marken].map(([m, mod]) => m + ' · ' + mod.size + ' Modell' + (mod.size === 1 ? '' : 'e'));
const modellBelege = (s) => [...s.marken].flatMap(([m, mod]) => [...mod.keys()].map((x) => m + ' ' + x));

export const ABZEICHEN = [
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
  { k: 'zeitzeuge', ico: '🪦', name: 'Zeitzeuge', text: 'Gesammelte Anlage wurde abgebaut', test: (s) => s.abgebaut.length > 0, belege: (s) => s.abgebaut.map((f) => fundTitel(f) + ' · ' + (f.ort || '')) },
];
ABZEICHEN.forEach((a) => {
  if (!a.fund) return;
  a.test = (s) => s.funde.some(a.fund);
  a.belege = (s) => s.funde.filter(a.fund).map(fundZeile);
});

// Sonderabzeichen: komplette Hersteller und Quartette
export function dynamischeAbzeichen(D, s) {
  const liste = [];
  for (const h of herstellerFortschritt(D, s)) {
    if (!h.komplett) continue;
    liste.push({ k: 'h:' + h.marke, ico: '🏁', name: h.marke + ' komplett', text: 'Alle aktiven Modelle',
      test: () => true, belege: () => h.modelle.map((m) => h.marke + ' ' + m.modell) });
  }
  for (const q of QUARTETTE) {
    const st = quartettStand(D, q, s);
    if (st.karten.length < 2 || st.gesammelt < st.karten.length) continue;
    liste.push({ k: 'q:' + q.k, ico: q.ico, name: q.name, text: 'Quartett komplett',
      test: () => true, belege: () => st.karten.map((m) => m.marke + ' ' + m.modell) });
  }
  return liste;
}

// Trägt neu erreichte Abzeichen ins Heft ein und gibt sie zurück
export function pruefeAbzeichen(D, heft) {
  const s = statistik(D, heft);
  const neu = [];
  for (const a of [...ABZEICHEN, ...dynamischeAbzeichen(D, s)]) {
    if (!heft.abzeichen[a.k] && a.test(s)) {
      heft.abzeichen[a.k] = Date.now();
      neu.push(a);
    }
  }
  return neu;
}

/* ---------------- Verlauf je Monat/Jahr ---------------- */

export function perioden(s, art) {
  const jetzt = new Date();
  const liste = [];
  if (art === 'monat') {
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
    const p = index.get(art === 'monat' ? d.getFullYear() + '-' + d.getMonth() : '' + d.getFullYear());
    if (!p) continue;
    p.anlagen++;
    p.kw += f.kw || 0;
    if (f.neuesModell) p.modelle++;
    if (f.b) p.beruehrt++;
  }
  return liste;
}
