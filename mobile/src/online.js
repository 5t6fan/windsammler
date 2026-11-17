// Online-Teil: Spielerkonto, Gruppen, Ranglisten, Punkte beim Sammeln, Bewertungen, Blockieren.
// Dieselbe Supabase-Datenbank und dieselben Funktionen wie web/online.js.
import 'expo-sqlite/localStorage/install';
import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: localStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

const WARTESCHLANGE = 'windsammler.warteschlange';
const GRUPPE_GEWAEHLT = 'windsammler.gruppe';
export const GLOBAL = 'global';

/* ---------- kleiner Zustandsspeicher mit React-Hook ---------- */

let zustand = { bereit: false, profil: null, gruppen: [], gruppe: null, warte: 0 };
const hoerer = new Set();
function setze(teil) {
  zustand = { ...zustand, ...teil };
  hoerer.forEach((h) => h());
}
export function useOnline() {
  return useSyncExternalStore((h) => { hoerer.add(h); return () => hoerer.delete(h); }, () => zustand);
}
export const angemeldet = () => !!zustand.profil;
// Sitzung ohne Profil (z. B. nach einem vergebenen Namen) – dann ist kein neues Captcha nötig
export const hatSitzung = async () => !!(await sb.auth.getSession()).data.session;

/* ---------- Hilfen ---------- */

const lies = async (k, standard) => { try { return JSON.parse(await AsyncStorage.getItem(k)) ?? standard; } catch (_) { return standard; } };
const schreib = (k, v) => AsyncStorage.setItem(k, JSON.stringify(v)).catch(() => {});
const netzfehler = (e) => /fetch|network|load failed|timeout|Netzwerk/i.test((e && e.message) || '');

export function fehlertext(e) {
  if (netzfehler(e)) return 'Keine Verbindung';
  if (e && e.code === '23505' && /profile_name/.test(e.message || '')) return 'Dieser Spielername ist schon vergeben';
  return (e && e.message) || 'Unbekannter Fehler';
}

async function rpc(name, params) {
  const { data, error } = await sb.rpc(name, params);
  if (error) throw error;
  return data;
}

/* ---------- Start & Konto ---------- */

export async function starte() {
  setze({ gruppe: await lies(GRUPPE_GEWAEHLT, null), warte: (await lies(WARTESCHLANGE, [])).length });
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) {
      await ladeProfil(data.session.user.id);
      await ladeGruppen();
    }
  } catch (_) { /* offline – später erneut */ }
  setze({ bereit: true });
  sendeWarteschlange();
}

// Token automatisch erneuern, solange die App im Vordergrund ist; dabei Wartendes senden
AppState.addEventListener('change', (s) => {
  if (s === 'active') { sb.auth.startAutoRefresh(); sendeWarteschlange(); } else sb.auth.stopAutoRefresh();
});

async function ladeProfil(uid) {
  const { data, error } = await sb.from('profile').select('id,name,global').eq('id', uid).maybeSingle();
  if (error) throw error;
  setze({ profil: data });
}

// captchaToken kommt aus der Captcha-Seite (Cloudflare Turnstile) im eingebetteten Browserfenster
export async function anmelden(name, captchaToken) {
  name = name.trim();
  if (name.length < 2) throw new Error('Bitte mindestens 2 Zeichen');
  let { data: { session } } = await sb.auth.getSession();
  if (!session) {
    if (!captchaToken) throw new Error('Bitte die Sicherheitsprüfung abwarten');
    const r = await sb.auth.signInAnonymously({ options: { captchaToken } });
    if (r.error) throw r.error;
    session = r.data.session;
  }
  const { error } = await sb.from('profile').upsert({ id: session.user.id, name });
  if (error) throw error;
  setze({ profil: { id: session.user.id, name, global: false } });
  await ladeGruppen();
  sendeWarteschlange();
}

export async function umbenennen(name) {
  name = name.trim();
  if (name.length < 2) throw new Error('Bitte mindestens 2 Zeichen');
  const { error } = await sb.from('profile').update({ name }).eq('id', zustand.profil.id);
  if (error) throw error;
  setze({ profil: { ...zustand.profil, name } });
}

export async function globalSetzen(an) {
  const { error } = await sb.from('profile').update({ global: an }).eq('id', zustand.profil.id);
  if (error) throw error;
  setze({ profil: { ...zustand.profil, global: an } });
}

export async function kontoLoeschen() {
  await rpc('konto_loeschen');
  await sb.auth.signOut();
  schreib(WARTESCHLANGE, []);
  entdeckerCache.clear();
  kommentarCache.clear();
  setze({ profil: null, gruppen: [], gruppe: null, warte: 0 });
}

/* ---------- Sammeln & Berühren (mit Warteschlange ohne Netz) ---------- */

export const sammeln = (id, lat, lon) => senden('sammeln', id, lat, lon);
export const beruehren = (id, lat, lon) => senden('beruehren', id, lat, lon);

async function senden(art, id, lat, lon) {
  if (!zustand.profil) return null;
  try {
    return await rpc(art, { p_anlage: id, p_lat: lat, p_lon: lon });
  } catch (e) {
    if (netzfehler(e)) {
      const q = await lies(WARTESCHLANGE, []);
      q.push({ art, id, lat, lon, zeit: new Date().toISOString() });
      schreib(WARTESCHLANGE, q);
      setze({ warte: q.length });
      return { wartend: true };
    }
    return { fehler: fehlertext(e) };
  } finally {
    entdeckerCache.delete(id);
    kommentarCache.delete(id);
  }
}

let sendetGerade = false;
// Gibt { gesendet, punkte } zurück, wenn etwas übertragen wurde
export async function sendeWarteschlange() {
  if (!zustand.profil || sendetGerade) return null;
  const q = await lies(WARTESCHLANGE, []);
  if (!q.length) return null;
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
  await schreib(WARTESCHLANGE, rest);
  sendetGerade = false;
  setze({ warte: rest.length });
  return { gesendet: q.length - rest.length, punkte };
}

/* ---------- Erstentdecker ---------- */

const entdeckerCache = new Map();
export async function entdecker(id) {
  if (!zustand.profil) return null;
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

export async function ladeGruppen() {
  if (!zustand.profil) return;
  const gruppen = (await rpc('meine_gruppen')) || [];
  let g = zustand.gruppe;
  if (g !== GLOBAL && !gruppen.some((x) => x.id === g)) g = gruppen[0] ? gruppen[0].id : GLOBAL;
  schreib(GRUPPE_GEWAEHLT, g);
  setze({ gruppen, gruppe: g });
}

export function waehleGruppe(g) {
  schreib(GRUPPE_GEWAEHLT, g);
  setze({ gruppe: g });
}

export async function gruppeErstellen(name) {
  if (name.trim().length < 2) throw new Error('Bitte einen Gruppennamen eingeben');
  const g = await rpc('gruppe_erstellen', { p_name: name.trim() });
  setze({ gruppe: g.id });
  await ladeGruppen();
  return g;
}

export async function gruppeBeitreten(code) {
  code = code.trim().toUpperCase();
  if (code.length !== 6) throw new Error('Der Code hat 6 Zeichen');
  const g = await rpc('gruppe_beitreten', { p_code: code });
  if (g.fehler) throw new Error(g.fehler);
  setze({ gruppe: g.id });
  await ladeGruppen();
  return g;
}

export async function gruppeVerlassen(id) {
  await rpc('gruppe_verlassen', { p_gruppe: id });
  setze({ gruppe: null });
  await ladeGruppen();
}

/* ---------- Ranglisten ---------- */

// Zeitraum [seit, bis) – zeitraum: monat | jahr | gesamt, versatz: 0 = aktuell, 1 = davor …
export function periode(zeitraum, versatz) {
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

export async function rangliste(gruppe, p) {
  if (gruppe === GLOBAL) {
    const zeilen = (await rpc('rangliste_global', { p_seit: p.seit, p_bis: p.bis })) || [];
    return zeilen.map((z) => ({ ...z, platz: Number(z.platz) }));
  }
  const zeilen = (await rpc('rangliste', { p_gruppe: gruppe, p_seit: p.seit, p_bis: p.bis })) || [];
  let platz = 0, vorher = null;
  return zeilen.map((z, i) => {
    if (z.punkte !== vorher) { platz = i + 1; vorher = z.punkte; }
    return { ...z, platz };
  });
}

export const meinStand = () => rpc('mein_stand');

/* ---------- Bewertungen & Blockieren ---------- */

const kommentarCache = new Map();
export async function kommentare(id, neu) {
  if (!zustand.profil) return null;
  if (!neu && kommentarCache.has(id)) return kommentarCache.get(id);
  const zeilen = (await rpc('kommentare_lesen', { p_anlage: id })) || [];
  kommentarCache.set(id, zeilen);
  return zeilen;
}
export const kommentarSpeichern = (id, sterne, text) => rpc('kommentar_speichern', { p_anlage: id, p_sterne: sterne, p_text: text });
export const kommentarLoeschen = (id) => rpc('kommentar_loeschen', { p_anlage: id });
export const kommentarMelden = (kommentarId) => rpc('kommentar_melden', { p_kommentar: kommentarId });
export async function blockieren(kommentarId) {
  await rpc('nutzer_blockieren', { p_kommentar: kommentarId });
  kommentarCache.clear();
}
export const blockierte = () => rpc('blockierte_lesen');
export async function entblocken(id) {
  await rpc('entblocken', { p_id: id });
  kommentarCache.clear();
}
