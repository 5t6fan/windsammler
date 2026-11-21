// Gemeinsamer App-Zustand: Anlagendaten, Sammelheft, Standort, Kompass, Auswahl, Meldungen
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { ladeDaten, anlage } from './lib/daten';
import { berechneNah, distanz } from './lib/geo';
import { entfernung } from './lib/format';
import { aktualisiereHeft, heftAbgleichen, pruefeAbzeichen, titel, SAMMEL_RADIUS, BERUEHR_RADIUS } from './lib/spiel';
import * as Online from './online';
import { starteHintergrund, stoppeHintergrund, laeuftHintergrund, schreibeListe } from './hintergrund';

// Schlüssel tragen noch den alten App-Namen – nicht umbenennen, sonst wären Sammelhefte und Einstellungen weg
const SPEICHER = 'windsammler.v1';
const HINWEIS = 'windsammler.hinweis';            // '1' = Hinweis, wenn eine neue Anlage sammelbar ist
const SICHERHEIT = 'windsammler.sicherheit.v1';   // '1' = Sicherheitshinweis bestätigt
const HINTERGRUND = 'windsammler.hintergrund';    // '1' = Hinweis auch im Hintergrund

// Mitteilungen auch zeigen, während die App offen ist
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});
// Testmodus nur in der Entwicklung: feste Position bei Kassel, Sammeln ohne Entfernungsgrenze
export const TEST_POS = { lat: 51.265, lon: 9.73, acc: 5 };

const Kontext = createContext(null);
export const useWind = () => useContext(Kontext);

export function WindProvider({ children }) {
  const [D, setD] = useState(null);
  const [ladeFehler, setLadeFehler] = useState(null);
  const [heft, setHeft] = useState(null);
  const [pos, setPos] = useState(null);
  const [heading, setHeading] = useState(null);
  const [standort, setStandort] = useState('aus');   // aus | sucht | an | verweigert | fehler
  const [test, setTest] = useState(false);
  const [radius, setRadius] = useState(5000);
  const [planung, setPlanung] = useState(false);
  const [auswahl, setAuswahl] = useState(null);      // manuell gewählte Anlage (Index) oder null
  const [meldung, setMeldung] = useState(null);
  const [hinweis, setHinweisState] = useState(false);
  const [hintergrund, setHintergrundState] = useState(false);
  const [sicherheit, setSicherheit] = useState(null);  // null = lädt, false = noch nicht bestätigt, true = bestätigt
  const [sicherheitOffen, setSicherheitOffen] = useState(false);
  const abos = useRef([]);
  const meldungTimer = useRef(null);

  const zeige = useCallback((text) => {
    setMeldung(text);
    clearTimeout(meldungTimer.current);
    meldungTimer.current = setTimeout(() => setMeldung(null), 2800);
  }, []);

  /* ---------- Daten und Sammelheft laden ---------- */

  useEffect(() => {
    (async () => {
      let h = null;
      try { h = JSON.parse(await AsyncStorage.getItem(SPEICHER)); } catch (_) { /* leer starten */ }
      if (!h || !h.funde) h = { v: 1, funde: {}, abzeichen: {} };
      setHeft(h);
    })();
    AsyncStorage.multiGet([HINWEIS, SICHERHEIT]).then(([[, h], [, sh]]) => {
      setHinweisState(h === '1');
      setSicherheit(sh === '1');
    }).catch(() => setSicherheit(false));
    // Läuft die Hintergrund-Ortung noch? (Erlaubnis kann in den Einstellungen entzogen worden sein)
    laeuftHintergrund().then(setHintergrundState);
    Online.starte();
    ladeDaten((neu) => setD(neu))
      .then(setD)
      .catch((e) => setLadeFehler(e.message || String(e)));
  }, []);

  const speichere = useCallback((h) => {
    AsyncStorage.setItem(SPEICHER, JSON.stringify(h)).catch(() => zeige('Speichern nicht möglich'));
  }, [zeige]);

  // Nach dem Laden: Funde an den Datenstand anpassen, neue Abzeichen (z. B. „Zeitzeuge“) vergeben
  useEffect(() => {
    if (!D || !heft) return;
    const h = { ...heft, funde: { ...heft.funde }, abzeichen: { ...heft.abzeichen } };
    for (const id of Object.keys(h.funde)) h.funde[id] = { ...h.funde[id] };
    const geaendert = aktualisiereHeft(D, h, anlage);
    const neu = pruefeAbzeichen(D, h);
    if (geaendert || neu.length) { setHeft(h); speichere(h); }
    if (neu.length) zeige(neu.map((x) => x.ico + ' ' + x.name).join(' · '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [D, heft === null]);

  // Nach der Anmeldung (auch auf einem neuen Gerät): online gewertete Funde ins Sammelheft übernehmen
  const heftRef = useRef(heft);
  heftRef.current = heft;
  const profilId = Online.useOnline().profil?.id;
  useEffect(() => {
    if (!D || !heftRef.current || !profilId) return;
    let abgebrochen = false;
    Online.meineFunde().then((liste) => {
      if (abgebrochen || !heftRef.current) return;
      const { h, neu } = heftAbgleichen(D, heftRef.current, liste, anlage);
      if (!h) return;
      setHeft(h);
      speichere(h);
      if (neu) zeige(neu + (neu === 1 ? ' Fund' : ' Funde') + ' aus deinem Online-Konto ins Sammelheft übernommen');
    }).catch(() => { /* offline – beim nächsten Start */ });
    return () => { abgebrochen = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [D, heft === null, profilId]);

  /* ---------- Sicherheitshinweis ---------- */

  const bestaetigeSicherheit = useCallback(() => {
    setSicherheit(true);
    setSicherheitOffen(false);
    AsyncStorage.setItem(SICHERHEIT, '1').catch(() => {});
  }, []);

  /* ---------- Hinweis: neue Anlage sammelbar ---------- */

  const setHinweis = useCallback(async (an) => {
    setHinweisState(an);
    AsyncStorage.setItem(HINWEIS, an ? '1' : '0').catch(() => {});
    if (!an) {
      stoppeHintergrund();
      setHintergrundState(false);
      AsyncStorage.setItem(HINTERGRUND, '0').catch(() => {});
      return;
    }
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('sammelbar', {
          // eslint-disable-next-line import/namespace -- per export * aus NotificationChannelManager.types
          name: 'Neue Anlage sammelbar', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 60, 80, 60],
        });
      }
      let { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
      zeige(status === 'granted' ? '🔔 Du bekommst einen Hinweis, sobald eine neue Anlage sammelbar ist'
        : 'Mitteilungen nicht erlaubt – du bekommst den Hinweis nur in der App');
    } catch (_) {
      zeige('Mitteilungen gehen hier nicht – du bekommst den Hinweis nur in der App');
    }
  }, [zeige]);

  // Auch im Hintergrund (Bildschirm gesperrt): eigene Ortungs-Aufgabe, siehe hintergrund.js
  const setHintergrund = useCallback(async (an) => {
    if (!an) {
      await stoppeHintergrund();
      setHintergrundState(false);
      AsyncStorage.setItem(HINTERGRUND, '0').catch(() => {});
      return;
    }
    try {
      const fehler = await starteHintergrund(D);
      if (fehler) { zeige(fehler); setHintergrundState(false); return; }
      setHintergrundState(true);
      AsyncStorage.setItem(HINTERGRUND, '1').catch(() => {});
      zeige('🔔 Auch bei gesperrtem Bildschirm aktiv – ausschalten, wenn du nicht unterwegs bist');
    } catch (_) {
      zeige('Hintergrund-Ortung konnte nicht gestartet werden');
      setHintergrundState(false);
    }
  }, [D, zeige]);

  // Neuer Datenstand: Liste der sammelbaren Anlagen für die Hintergrund-Aufgabe erneuern
  useEffect(() => {
    if (D && hintergrund) schreibeListe(D);
  }, [D, hintergrund]);

  // Tipp auf die Mitteilung: Anlage auswählen und „In der Nähe“ zeigen
  const DRef = useRef(D);
  useEffect(() => { DRef.current = D; }, [D]);
  useEffect(() => {
    const abo = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = r.notification.request.content.data || {};
      // Vordergrund: Index; Hintergrund-Aufgabe: MaStR-Nummer
      const i = typeof data.i === 'number' ? data.i : DRef.current && data.id ? DRef.current.idIndex.get(data.id) : null;
      if (typeof i !== 'number') return;
      setAuswahl(i);
      try { router.navigate('/'); } catch (_) { /* Navigation noch nicht bereit */ }
    });
    return () => abo.remove();
  }, []);

  /* ---------- Standort und Kompass ---------- */

  const stoppeStandort = () => { abos.current.forEach((a) => a.remove()); abos.current = []; };

  const starteStandort = useCallback(async () => {
    setStandort('sucht');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { setStandort('verweigert'); return; }
    stoppeStandort();
    try {
      abos.current.push(await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 3 },
        (p) => { setPos({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }); setStandort('an'); },
      ));
      let letzter = null;
      abos.current.push(await Location.watchHeadingAsync((h) => {
        const grad = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        // nur merkliche Drehungen weitergeben – spart Neuzeichnen
        if (letzter == null || Math.abs(((grad - letzter + 540) % 360) - 180) >= 2) { letzter = grad; setHeading(grad); }
      }));
    } catch (_) {
      setStandort('fehler');
    }
  }, []);

  useEffect(() => stoppeStandort, []);

  const aktPos = test ? TEST_POS : pos;
  const sammelRadius = test ? Infinity : SAMMEL_RADIUS;
  const beruehrRadius = test ? Infinity : BERUEHR_RADIUS;

  /* ---------- Anlagen in der Nähe ---------- */
  // Nur neu berechnen, wenn man sich merklich (> 15 m) bewegt hat
  const basis = useRef(null);
  const [rechenPos, setRechenPos] = useState(null);
  useEffect(() => {
    if (!aktPos) return;
    const b = basis.current;
    if (!b || distanz(aktPos.lat, aktPos.lon, b.lat, b.lon) > 15) { basis.current = aktPos; setRechenPos(aktPos); }
  }, [aktPos]);

  const umgebung = useMemo(() => {
    if (!D || !rechenPos || !heft) return { nah: [], naechste: null, neu: null, unberuehrt: null };
    return berechneNah(D, rechenPos, radius, planung, heft.funde);
  }, [D, rechenPos, radius, planung, heft]);

  const sel = auswahl ?? umgebung.naechste;

  // Nächste noch nicht gesammelte Anlage (ohne geplante und Offshore) in Sammelreichweite? Einmal je Anlage melden.
  const gemeldet = useRef(new Set());
  useEffect(() => {
    if (!hinweis || !D || !rechenPos || !heft || umgebung.neu == null) return;
    const a = anlage(D, umgebung.neu);
    const d = distanz(rechenPos.lat, rechenPos.lon, a.lat, a.lon);
    if (d > sammelRadius || heft.funde[a.id] || gemeldet.current.has(a.id)) return;
    gemeldet.current.add(a.id);
    const text = titel(a) + ' · ' + entfernung(d) + ' entfernt' + (a.ort ? ' · ' + a.ort : '');
    zeige('★ Neue Anlage sammelbar: ' + text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    Notifications.scheduleNotificationAsync({
      content: { title: '★ Neue Anlage sammelbar', body: text, data: { i: umgebung.neu } },
      trigger: Platform.OS === 'android' ? { channelId: 'sammelbar' } : null,
    }).catch(() => { /* ohne Erlaubnis: nur die Meldung in der App */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hinweis, D, rechenPos, umgebung.neu]);

  /* ---------- Sammeln und Berühren ---------- */

  const sammle = useCallback(async (beruehrt) => {
    if (!D || sel == null || !aktPos || !heft) return;
    const a = anlage(D, sel);
    const d = distanz(aktPos.lat, aktPos.lon, a.lat, a.lon);
    const alt = heft.funde[a.id];
    if (a.planung) return;
    if (beruehrt ? d > beruehrRadius || (alt && alt.b) : d > sammelRadius || alt) return;

    const funde = Object.values(heft.funde);
    const neuesModell = !alt && a.modell && !funde.some((f) => f.marke === a.marke && f.modell === a.modell);
    const neueMarke = !alt && a.marke && !funde.some((f) => f.marke === a.marke);
    const jetzt = Date.now();
    // Kopie der wichtigsten Angaben, damit das Heft auch nach Daten-Updates (und Abbau) vollständig bleibt
    const fund = alt ? { ...alt } : {
      t: jetzt, marke: a.marke, modell: a.modell, typ: a.typ, kw: a.kw, nabe: a.nabe, rotor: a.rotor,
      ibn: a.ibn, ort: a.ort, kreis: a.kreis, land: a.land, park: a.parkKey, lat: a.lat, lon: a.lon, bauform: a.bauform,
    };
    if (beruehrt) fund.b = jetzt;
    const h = { ...heft, funde: { ...heft.funde, [a.id]: fund }, abzeichen: { ...heft.abzeichen } };
    const neu = pruefeAbzeichen(D, h);
    setHeft(h);
    speichere(h);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    let text = neu.length ? neu.map((x) => x.ico + ' ' + x.name).join(' · ')
      : neueMarke ? 'Neue Marke: ' + a.marke + '!'
      : neuesModell ? 'Neues Modell: ' + titel(a) + '!'
      : beruehrt ? '🤚 Turm berührt: ' + titel(a)
      : 'Gesammelt: ' + titel(a);
    zeige(text);
    // Rangliste: Server prüft die Entfernung erneut und vergibt Punkte
    if (Online.angemeldet()) {
      const r = beruehrt ? await Online.beruehren(a.id, aktPos.lat, aktPos.lon) : await Online.sammeln(a.id, aktPos.lat, aktPos.lon);
      if (r && (r.erstentdecker || r.erstberuehrt)) {
        // eigene Erstfunde im Heft vermerken (für Abzeichen und Fundliste)
        const h2 = { ...h, funde: { ...h.funde, [a.id]: { ...h.funde[a.id], ...(r.erstentdecker && { erst: true }), ...(r.erstberuehrt && { erstB: true }) } }, abzeichen: { ...h.abzeichen } };
        const extra = pruefeAbzeichen(D, h2);
        setHeft(h2);
        speichere(h2);
        if (extra.length) text += ' · ' + extra.map((x) => x.ico + ' ' + x.name).join(' · ');
      }
      if (r && r.punkte) text = '+' + r.punkte + ' Punkte · ' + text + (r.erstentdecker ? ' · 🚩 Erstentdecky!' : '') + (r.erstberuehrt ? ' · 🖐️ Als Erstes am Turm!' : '');
      else if (r && r.wartend) text += ' · wird übertragen, sobald Netz da ist';
      else if (r && r.fehler) text += ' · nicht gewertet: ' + r.fehler;
      zeige(text);
    }
  }, [D, sel, aktPos, heft, beruehrRadius, sammelRadius, speichere, zeige]);

  // Import einer Sicherung (auch aus der Web-App): zusammenführen statt überschreiben
  const importiere = useCallback((fremd) => {
    if (!fremd || typeof fremd.funde !== 'object') throw new Error('Kein turbineSpotty-Export');
    const h = { v: 1, funde: { ...fremd.funde, ...heft.funde }, abzeichen: { ...(fremd.abzeichen || {}), ...heft.abzeichen } };
    for (const id of Object.keys(h.funde)) h.funde[id] = { ...h.funde[id] };
    if (D) { aktualisiereHeft(D, h, anlage); pruefeAbzeichen(D, h); }
    setHeft(h);
    speichere(h);
    return Object.keys(fremd.funde).length;
  }, [D, heft, speichere]);

  const wert = {
    D, ladeFehler, heft, pos: aktPos, heading, standort, starteStandort,
    test, setTest, radius, setRadius, planung, setPlanung,
    nah: umgebung.nah, naechste: umgebung.naechste, neu: umgebung.neu, unberuehrt: umgebung.unberuehrt, sel, manuell: auswahl != null && auswahl !== umgebung.naechste,
    waehle: setAuswahl, zurNaechsten: () => setAuswahl(null),
    sammelRadius, beruehrRadius, sammle, importiere,
    meldung, zeige,
    hinweis, setHinweis, hintergrund, setHintergrund,
    sicherheit, sicherheitOffen, setSicherheitOffen, bestaetigeSicherheit,
  };
  return <Kontext.Provider value={wert}>{children}</Kontext.Provider>;
}
