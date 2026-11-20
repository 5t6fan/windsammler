// Hinweis auf sammelbare Anlagen auch im Hintergrund (Bildschirm gesperrt, App nicht offen).
//
// Das System weckt die App bei Ortswechseln und ruft die Aufgabe unten auf. Damit das schnell geht,
// liegt eine schlanke Liste aller sammelbaren Anlagen (an Land, nicht geplant) als eigene Datei auf
// dem Gerät; die gesammelten Funde kommen aus dem Sammelheft. Der Standort verlässt das Gerät nicht.
//
// Geht nur in einer eigenen App-Fassung (EAS-Build), nicht in Expo Go.
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { anlage } from './lib/daten';
import { distanz } from './lib/geo';
import { entfernung } from './lib/format';
import { titel, SAMMEL_RADIUS } from './lib/spiel';

export const AUFGABE = 'windsammler-sammelbar';
const SPEICHER = 'windsammler.v1';                // Sammelheft (wie in zustand.js)
const GEMELDET = 'windsammler.gemeldet';          // schon gemeldete Anlagen: id -> Zeitpunkt
const ERNEUT_NACH = 7 * 24 * 3600 * 1000;         // nicht gesammelte Anlage frühestens nach einer Woche erneut melden
const datei = () => new File(Paths.document, 'sammelbar.json');

export const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/* ---------- Liste der sammelbaren Anlagen ---------- */

// Nur neu schreiben, wenn sich der Datenstand geändert hat
export async function schreibeListe(D) {
  try {
    const f = datei();
    if (f.exists) {
      const alt = JSON.parse(await f.text());
      if (alt.stand === D.meta.erzeugt) return;
    }
    const L = { stand: D.meta.erzeugt, id: [], lat: [], lon: [], t: [], o: [] };
    const F = D.F;
    for (let i = 0; i < D.n; i++) {
      const z = D.rows[i];
      if (z[F.status] === D.planungIdx || z[F.see] === 1) continue;
      const a = anlage(D, i);
      L.id.push(a.id); L.lat.push(a.lat); L.lon.push(a.lon); L.t.push(titel(a)); L.o.push(a.ort || '');
    }
    if (!f.exists) f.create();
    await f.write(JSON.stringify(L));
    liste = L;
  } catch (_) { /* nächstes Mal erneut */ }
}

let liste = null;   // bleibt geladen, solange die App im Speicher ist
async function ladeListe() {
  if (liste) return liste;
  const f = datei();
  if (!f.exists) return null;
  liste = JSON.parse(await f.text());
  return liste;
}

/* ---------- Aufgabe: bei jedem Ortswechsel prüfen ---------- */

TaskManager.defineTask(AUFGABE, async ({ data, error }) => {
  if (error || !data || !data.locations || !data.locations.length) return;
  // Ist die App offen, meldet sie selbst (zustand.js) – sonst käme der Hinweis doppelt
  if (AppState.currentState === 'active') return;
  try {
    const p = data.locations[data.locations.length - 1].coords;
    await pruefe(p.latitude, p.longitude);
  } catch (_) { /* nächster Ortswechsel */ }
});

async function pruefe(lat, lon) {
  const L = await ladeListe();
  if (!L) return;
  // Nächste Anlage in Reichweite, die man noch nicht hat
  const [[, heftText], [, gemeldetText]] = await AsyncStorage.multiGet([SPEICHER, GEMELDET]);
  const funde = (heftText && JSON.parse(heftText).funde) || {};
  const gemeldet = (gemeldetText && JSON.parse(gemeldetText)) || {};
  const jetzt = Date.now();
  const grob = SAMMEL_RADIUS / 111320 * 1.5;
  let best = -1, bestD = Infinity;
  for (let k = 0; k < L.id.length; k++) {
    if (Math.abs(L.lat[k] - lat) > grob) continue;
    const d = distanz(lat, lon, L.lat[k], L.lon[k]);
    if (d > SAMMEL_RADIUS || d >= bestD) continue;
    const id = L.id[k];
    if (funde[id] || (gemeldet[id] && jetzt - gemeldet[id] < ERNEUT_NACH)) continue;
    best = k; bestD = d;
  }
  if (best < 0) return;
  gemeldet[L.id[best]] = jetzt;
  // Alte Einträge aufräumen, damit die Liste nicht endlos wächst
  for (const [id, t] of Object.entries(gemeldet)) if (jetzt - t > ERNEUT_NACH || funde[id]) delete gemeldet[id];
  await AsyncStorage.setItem(GEMELDET, JSON.stringify(gemeldet));
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '★ Neue Anlage sammelbar',
      body: L.t[best] + ' · ' + entfernung(bestD) + ' entfernt' + (L.o[best] ? ' · ' + L.o[best] : ''),
      data: { id: L.id[best] },
    },
    trigger: Platform.OS === 'android' ? { channelId: 'sammelbar' } : null,
  });
}

/* ---------- Ein- und ausschalten ---------- */

// Liefert null bei Erfolg, sonst einen Text, warum es nicht geht
export async function starteHintergrund(D) {
  if (inExpoGo) return 'Im Hintergrund geht das erst in der fertigen App, nicht in Expo Go.';
  if (!(await TaskManager.isAvailableAsync())) return 'Hintergrund-Ortung ist auf diesem Gerät nicht verfügbar.';
  const vorne = await Location.requestForegroundPermissionsAsync();
  if (vorne.status !== 'granted') return 'Standort nicht freigegeben.';
  const hinten = await Location.requestBackgroundPermissionsAsync();
  if (hinten.status !== 'granted') {
    return Platform.OS === 'ios'
      ? 'Bitte in den Einstellungen unter Windsammler → Standort „Immer“ wählen.'
      : 'Bitte in den Einstellungen beim Standort „Immer zulassen“ wählen.';
  }
  if (D) await schreibeListe(D);
  if (await Location.hasStartedLocationUpdatesAsync(AUFGABE)) return null;
  await Location.startLocationUpdatesAsync(AUFGABE, {
    accuracy: Location.Accuracy.Balanced,   // reicht für 300 m und schont den Akku
    distanceInterval: 75,
    deferredUpdatesDistance: 75,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: true,       // iOS pausiert bei Stillstand und spart Akku
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Windsammler hält Ausschau',
      notificationBody: 'Du bekommst einen Hinweis, sobald eine neue Anlage sammelbar ist.',
      notificationColor: '#0e6b58',
    },
  });
  return null;
}

export async function stoppeHintergrund() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(AUFGABE)) await Location.stopLocationUpdatesAsync(AUFGABE);
  } catch (_) { /* war nicht aktiv */ }
}

export async function laeuftHintergrund() {
  if (inExpoGo) return false;
  try { return await Location.hasStartedLocationUpdatesAsync(AUFGABE); } catch (_) { return false; }
}
