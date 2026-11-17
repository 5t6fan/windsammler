// Anlagendaten (Marktstammdatenregister) laden: zuerst aus dem Gerätespeicher, im Hintergrund
// von GitHub Pages aktualisieren. Dieselbe Datei wie die Web-App, gebaut von pipeline/build_wind.py.
import { File, Paths } from 'expo-file-system';

export const DATEN_URL = 'https://5t6fan.github.io/windsammler/data/wind.json';
export const AKTIV_MIN = 10;  // ein Modell zählt als „aktiv“, wenn so viele Anlagen an Land in Betrieb sind

const datei = () => new File(Paths.document, 'wind.json');

// Liefert die Daten so schnell wie möglich; meldet eine neuere Fassung über aktualisiert(D)
export async function ladeDaten(aktualisiert) {
  const f = datei();
  if (f.exists) {
    try {
      const D = bereite(JSON.parse(await f.text()));
      aktualisiereImHintergrund(D.meta.erzeugt, aktualisiert);
      return D;
    } catch (_) { /* beschädigt – neu laden */ }
  }
  const text = await lade();
  const D = bereite(JSON.parse(text));
  speichere(text);
  return D;
}

async function lade() {
  const r = await fetch(DATEN_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function speichere(text) {
  try {
    const f = datei();
    if (!f.exists) f.create();
    await f.write(text);
  } catch (_) { /* nächstes Mal erneut */ }
}

async function aktualisiereImHintergrund(stand, aktualisiert) {
  try {
    const text = await lade();
    const roh = JSON.parse(text);
    if (roh.meta.erzeugt === stand) return;
    speichere(text);
    aktualisiert(bereite(roh));
  } catch (_) { /* offline – alte Daten behalten */ }
}

// Indizes und Modellkatalog aufbauen (wie init() der Web-App)
function bereite(d) {
  const F = Object.fromEntries(d.felder.map((f, i) => [f, i]));
  const n = d.anlagen.length;
  const D = {
    meta: d.meta, F, n, rows: d.anlagen,
    hersteller: d.hersteller, status: d.status, bundesland: d.bundesland,
    abgebaut: d.abgebaut || {},
    lat: new Float64Array(n), lon: new Float64Array(n),
    idIndex: new Map(), modellAnzahl: new Map(), parkAnzahl: new Map(), markeAnzahl: new Map(),
    katalog: new Map(), aktivProMarke: new Map(),
    planungIdx: d.status.indexOf('In Planung'),
  };
  const betriebIdx = d.status.indexOf('In Betrieb');
  const zaehle = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const roh = new Map();
  for (let i = 0; i < n; i++) {
    const z = d.anlagen[i];
    D.lat[i] = z[F.lat];
    D.lon[i] = z[F.lon];
    D.idIndex.set(z[F.id], i);
    if (z[F.status] === D.planungIdx) continue;
    zaehle(D.markeAnzahl, z[F.hersteller]);
    if (z[F.modell]) zaehle(D.modellAnzahl, z[F.hersteller] + '|' + z[F.modell]);
    if (z[F.park]) zaehle(D.parkAnzahl, z[F.park] + '|' + z[F.kreis]);
    if (z[F.status] !== betriebIdx || z[F.see] === 1 || !z[F.modell] || z[F.hersteller] == null) continue;
    const k = d.hersteller[z[F.hersteller]] + '|' + z[F.modell];
    if (!roh.has(k)) roh.set(k, { n: 0, kw: [], rotor: [], nabe: [], ibn: null });
    const r = roh.get(k);
    r.n++;
    if (z[F.kw]) r.kw.push(z[F.kw]);
    if (z[F.rotor]) r.rotor.push(z[F.rotor]);
    if (z[F.nabe]) r.nabe.push(z[F.nabe]);
    if (z[F.ibn] && (!r.ibn || z[F.ibn] < r.ibn)) r.ibn = z[F.ibn];
  }
  for (const [k, r] of roh) {
    if (r.n < AKTIV_MIN) continue;
    const [marke, modell] = k.split('|');
    const m = {
      k, marke, modell, n: r.n, kw: median(r.kw), rotor: median(r.rotor), ibn: r.ibn,
      nabe: median(r.nabe), nabeMin: r.nabe.length ? Math.min(...r.nabe) : null, nabeMax: r.nabe.length ? Math.max(...r.nabe) : null,
    };
    D.katalog.set(k, m);
    if (!D.aktivProMarke.has(marke)) D.aktivProMarke.set(marke, []);
    D.aktivProMarke.get(marke).push(m);
  }
  for (const liste of D.aktivProMarke.values()) liste.sort((a, b) => b.n - a.n);
  return D;
}

function median(werte) {
  if (!werte.length) return null;
  const s = werte.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

export function anlage(D, i) {
  const z = D.rows[i], F = D.F;
  const h = z[F.hersteller];
  const park = z[F.park];
  return {
    i, id: z[F.id], lat: z[F.lat], lon: z[F.lon], name: z[F.name], park,
    marke: h != null ? D.hersteller[h] : null, markeIdx: h,
    typ: z[F.typ], modell: z[F.modell], kw: z[F.kw], nabe: z[F.nabe], rotor: z[F.rotor],
    ibn: z[F.ibn], status: D.status[z[F.status]], planung: z[F.status] === D.planungIdx,
    ort: z[F.ort], kreis: z[F.kreis], land: z[F.land] != null ? D.bundesland[z[F.land]] : null,
    see: z[F.see] === 1, parkKey: park ? park + '|' + z[F.kreis] : null,
  };
}
