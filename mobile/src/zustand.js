// Gemeinsamer App-Zustand: Anlagendaten, Sammelheft, Standort, Kompass, Auswahl, Meldungen
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { ladeDaten, anlage } from './lib/daten';
import { berechneNah, distanz } from './lib/geo';
import { aktualisiereHeft, pruefeAbzeichen, titel, SAMMEL_RADIUS, BERUEHR_RADIUS } from './lib/spiel';

const SPEICHER = 'windsammler.v1';
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
    if (!D || !rechenPos) return { nah: [], naechste: null };
    return berechneNah(D, rechenPos, radius, planung);
  }, [D, rechenPos, radius, planung]);

  const sel = auswahl ?? umgebung.naechste;

  /* ---------- Sammeln und Berühren ---------- */

  const sammle = useCallback((beruehrt) => {
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
      ibn: a.ibn, ort: a.ort, kreis: a.kreis, land: a.land, park: a.parkKey, lat: a.lat, lon: a.lon,
    };
    if (beruehrt) fund.b = jetzt;
    const h = { ...heft, funde: { ...heft.funde, [a.id]: fund }, abzeichen: { ...heft.abzeichen } };
    const neu = pruefeAbzeichen(D, h);
    setHeft(h);
    speichere(h);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    zeige(neu.length ? neu.map((x) => x.ico + ' ' + x.name).join(' · ')
      : neueMarke ? 'Neue Marke: ' + a.marke + '!'
      : neuesModell ? 'Neues Modell: ' + titel(a) + '!'
      : beruehrt ? '🤚 Turm berührt: ' + titel(a)
      : 'Gesammelt: ' + titel(a));
  }, [D, sel, aktPos, heft, beruehrRadius, sammelRadius, speichere, zeige]);

  // Import einer Sicherung (auch aus der Web-App): zusammenführen statt überschreiben
  const importiere = useCallback((fremd) => {
    if (!fremd || typeof fremd.funde !== 'object') throw new Error('Kein Windsammler-Export');
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
    nah: umgebung.nah, naechste: umgebung.naechste, sel, manuell: auswahl != null && auswahl !== umgebung.naechste,
    waehle: setAuswahl, zurNaechsten: () => setAuswahl(null),
    sammelRadius, beruehrRadius, sammle, importiere,
    meldung, zeige,
  };
  return <Kontext.Provider value={wert}>{children}</Kontext.Provider>;
}
