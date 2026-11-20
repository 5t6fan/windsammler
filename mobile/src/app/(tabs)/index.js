import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useWind } from '../../zustand';
import { useFarben, PUNKT } from '../../farben';
import { anlage } from '../../lib/daten';
import { peilung, distanz, sektor, RICHTUNGEN, KURZ, PFEILE } from '../../lib/geo';
import { entfernung, fmt0, datum } from '../../lib/format';
import { beschreibung, etiketten, titel, istAbgebaut, fundTitel, teilText } from '../../lib/spiel';
import { WEB } from '../../config';
import { Karte, Knopf, Chips, Leise, Etikett, Abschnitt } from '../../ui';
import { Bewertungen, Entdecker } from '../../bewertungen';

const LISTE_MAX = 50;
const KARTE_MAX = 1000;  // so viele Punkte höchstens auf der Karte – reicht für 25 km auch in dichten Gegenden

export default function Naehe() {
  const w = useWind();
  const c = useFarben();
  const scroll = useRef(null);
  const { D, pos } = w;

  if (!D || !w.heft) {
    return <View style={st.mitte}><Leise>{w.ladeFehler ? 'Daten konnten nicht geladen werden (' + w.ladeFehler + ').' : 'Lade Anlagendaten …'}</Leise></View>;
  }

  return (
    <ScrollView ref={scroll} contentContainerStyle={st.inhalt}>
      {!pos ? <Start /> : <Ziel />}
      <Kartenbereich />
      <View style={st.filter}>
        <Chips werte={[[2000, '2 km'], [5000, '5 km'], [10000, '10 km'], [25000, '25 km']]} wert={w.radius} onWahl={w.setRadius} />
        <View style={st.schalter}>
          <Switch value={w.planung} onValueChange={w.setPlanung} trackColor={{ true: c.akzent }} />
          <Leise klein>geplante</Leise>
        </View>
      </View>
      <View style={[st.schalter, { marginTop: 10 }]}>
        <Switch value={w.hinweis} onValueChange={w.setHinweis} trackColor={{ true: c.akzent }} />
        <Leise klein style={{ flex: 1 }}>🔔 Hinweis, wenn eine neue Anlage sammelbar ist (während die App läuft)</Leise>
      </View>
      {pos && <Liste onWahl={() => scroll.current && scroll.current.scrollTo({ y: 0, animated: true })} />}
    </ScrollView>
  );
}

function Start() {
  const w = useWind();
  const c = useFarben();
  const text = {
    sucht: 'Suche Standort …',
    verweigert: 'Standort nicht freigegeben – bitte in den Einstellungen erlauben.',
    fehler: 'Standort nicht verfügbar.',
  }[w.standort];
  return (
    <Karte style={{ alignItems: 'center', paddingVertical: 24 }}>
      <Text style={[st.startTitel, { color: c.text }]}>Welche Windräder sind in deiner Nähe?</Text>
      <Leise style={{ textAlign: 'center', marginBottom: 14 }}>Für Entfernung und Richtung braucht die App deinen Standort, für den Pfeil den Kompass.</Leise>
      <Knopf haupt titel="Standort & Kompass aktivieren" style={{ alignSelf: 'stretch' }}
        onPress={() => (w.sicherheit ? w.starteStandort() : w.setSicherheitOffen('start'))} />
      {text && <Leise klein style={{ marginTop: 10 }}>{text}</Leise>}
      <Pressable onPress={() => w.setSicherheitOffen(true)} style={{ marginTop: 14 }} accessibilityRole="button">
        <Leise klein style={{ textAlign: 'center' }}>⚠️ Suche und Betreten von Windparkflächen auf eigene Gefahr. <Text style={{ textDecorationLine: 'underline' }}>Sicherheitshinweise</Text></Leise>
      </Pressable>
      {__DEV__ && (
        <Pressable onPress={() => w.setTest(true)} style={{ marginTop: 14 }}>
          <Text style={{ color: c.leise, textDecorationLine: 'underline' }}>Testmodus: feste Position bei Kassel</Text>
        </Pressable>
      )}
    </Karte>
  );
}

function Kompass({ winkel, groesse = 104 }) {
  const c = useFarben();
  return (
    <View style={{ width: groesse, height: groesse, borderRadius: groesse / 2, backgroundColor: c.akzentHell, borderWidth: 2, borderColor: c.linie, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ transform: [{ rotate: winkel + 'deg' }], alignItems: 'center' }}>
        <View style={[st.dreieck, { borderBottomColor: c.akzent, borderLeftWidth: groesse * 0.14, borderRightWidth: groesse * 0.14, borderBottomWidth: groesse * 0.4 }]} />
        <View style={[st.dreieck, { borderBottomColor: c.leise, opacity: 0.45, borderLeftWidth: groesse * 0.14, borderRightWidth: groesse * 0.14, borderBottomWidth: groesse * 0.4, transform: [{ rotate: '180deg' }] }]} />
      </View>
    </View>
  );
}

function Ziel() {
  const w = useWind();
  const c = useFarben();
  const { D, pos, sel, heft } = w;
  if (sel == null) return <Karte><Leise>Keine Anlage gefunden.</Leise></Karte>;
  const a = anlage(D, sel);
  const d = distanz(pos.lat, pos.lon, a.lat, a.lon);
  const b = peilung(pos.lat, pos.lon, a.lat, a.lon);
  const fund = heft.funde[a.id];
  const ohneKompass = w.heading == null;
  const winkel = ohneKompass ? b : b - w.heading;

  let sammelText, sammelAus = true;
  if (fund) sammelText = '✓ Gesammelt am ' + datum(fund.t);
  else if (a.planung) sammelText = 'Geplant – noch nicht sammelbar';
  else if (d > w.sammelRadius) sammelText = 'Sammeln ab ' + w.sammelRadius + ' m (noch ' + entfernung(d - w.sammelRadius) + ')';
  else { sammelText = '★ Jetzt sammeln'; sammelAus = false; }

  const zeigeBeruehren = !a.planung && ((fund && fund.b) || d <= w.sammelRadius);
  const beruehrText = fund && fund.b ? '🤚 Berührt am ' + datum(fund.b)
    : d > w.beruehrRadius ? '🤚 Berühren unter ' + w.beruehrRadius + ' m' : '🤚 Turm berührt';

  return (
    <Karte>
      <View style={st.zielOben}>
        <Kompass winkel={winkel} />
        <View style={{ flex: 1 }}>
          <Leise klein>{w.manuell ? 'Ausgewählte Anlage' : 'Nächste Anlage'}</Leise>
          <Text style={[st.dist, { color: c.text }]}>{entfernung(d)}</Text>
          <Leise>Richtung {RICHTUNGEN[sektor(b)]} ({fmt0.format(b)}°)</Leise>
        </View>
      </View>
      <Text style={[st.zielTitel, { color: c.text }]}>{titel(a)}</Text>
      <Leise>{[a.park || a.name, a.ort, a.kreis].filter(Boolean).join(' · ')}</Leise>
      <View style={st.etiketten}>{etiketten(D, a, fund).map((e) => <Etikett key={e.text} {...e} />)}</View>
      <Text style={[st.zielText, { color: c.text }]}>{beschreibung(D, a)}</Text>
      <Entdecker key={a.id + (fund ? ':g' : '')} id={a.id} />
      <View style={st.aktionen}>
        <Knopf haupt titel={sammelText} disabled={sammelAus} onPress={() => w.sammle(false)} />
        {zeigeBeruehren && <Knopf titel={beruehrText} disabled={!!(fund && fund.b) || d > w.beruehrRadius} onPress={() => w.sammle(true)} />}
        {w.manuell && <Knopf titel="Zur nächsten" onPress={w.zurNaechsten} />}
        {fund && <Knopf titel="📤 Teilen" onPress={() => Share.share({ message: teilText(fund, Object.keys(heft.funde).length, WEB) }).catch(() => {})} />}
      </View>
      {ohneKompass && <Leise klein style={{ marginTop: 8 }}>Kein Kompass: Der Pfeil zeigt relativ zu Norden (oben).</Leise>}
      {w.test && <Leise klein style={{ marginTop: 8 }}>Testmodus aktiv – feste Position, Sammeln ohne Entfernungsgrenze.</Leise>}
      <Bewertungen id={a.id} gesammelt={!!fund} zeige={w.zeige} />
    </Karte>
  );
}

function Kartenbereich() {
  const w = useWind();
  const c = useFarben();
  const karte = useRef(null);
  const [funde, setFunde] = useState(false);
  const zentriert = useRef(false);
  const { D, pos, sel, nah, heft } = w;

  const punkte = useMemo(() => {
    const liste = nah.slice(0, KARTE_MAX).map((x) => x.i);
    if (sel != null && !liste.includes(sel)) liste.push(sel);
    return liste;
  }, [nah, sel]);

  const fundPunkte = useMemo(() => {
    if (!funde) return [];
    const schon = new Set(punkte);
    return Object.entries(heft.funde)
      .filter(([id, f]) => f.lat != null && !schon.has(D.idIndex.get(id)))
      .map(([id, f]) => ({ id, f, weg: istAbgebaut(D, id) }));
  }, [funde, heft, punkte, D]);

  const zentriere = () => {
    if (!pos || !karte.current) return;
    const k = [{ latitude: pos.lat, longitude: pos.lon }, ...punkte.slice(0, 8).map((i) => ({ latitude: D.lat[i], longitude: D.lon[i] }))];
    karte.current.fitToCoordinates(k, { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true });
  };

  useEffect(() => {
    if (pos && nah.length && !zentriert.current) { zentriert.current = true; setTimeout(zentriere, 300); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, nah]);

  // Nach Wahl des Radius: alle Anlagen im Umkreis vollständig zeigen (ohne Anlagen: den ganzen Kreis)
  const radiusVorher = useRef(w.radius);
  useEffect(() => {
    if (radiusVorher.current === w.radius) return;
    radiusVorher.current = w.radius;
    if (!pos || !karte.current) return;
    const k = [{ latitude: pos.lat, longitude: pos.lon }, ...nah.map(({ i }) => ({ latitude: D.lat[i], longitude: D.lon[i] }))];
    if (sel != null) k.push({ latitude: D.lat[sel], longitude: D.lon[sel] });
    if (k.length === 1) {
      const dLat = w.radius / 111320, dLon = dLat / Math.cos(pos.lat * Math.PI / 180);
      k.push({ latitude: pos.lat + dLat, longitude: pos.lon + dLon }, { latitude: pos.lat - dLat, longitude: pos.lon - dLon });
    }
    karte.current.fitToCoordinates(k, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.radius, nah]);

  const zeigeFunde = () => {
    const an = !funde;
    setFunde(an);
    if (!an) return;
    const k = Object.values(heft.funde).filter((f) => f.lat != null).map((f) => ({ latitude: f.lat, longitude: f.lon }));
    if (!k.length) return w.zeige('Noch keine Funde für die Karte');
    if (pos) k.push({ latitude: pos.lat, longitude: pos.lon });
    setTimeout(() => karte.current && karte.current.fitToCoordinates(k, { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true }), 50);
  };

  // Richtung der Linie von mir zur gewählten Anlage (auf 5° gerundet, damit der Marker selten neu zeichnet)
  const wegPeilung = pos && sel != null ? Math.round(peilung(pos.lat, pos.lon, D.lat[sel], D.lon[sel]) / 5) * 5 : 0;

  // Die vielen Punkte nur neu aufbauen, wenn sich Auswahl, Umkreis oder Funde ändern – nicht bei jeder Kompassdrehung
  const waehle = useRef(w.waehle);
  waehle.current = w.waehle;
  const punktMarker = useMemo(() => punkte.map((i) => {
    if (i === sel) return null;
    const z = D.rows[i];
    const f = heft.funde[z[D.F.id]] ? PUNKT.gesammelt : z[D.F.status] === D.planungIdx ? PUNKT.planung : PUNKT.aktiv;
    return (
      <Marker key={i + f} coordinate={{ latitude: D.lat[i], longitude: D.lon[i] }} anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={false} onPress={() => waehle.current(i)}>
        <View style={[st.punkt, { backgroundColor: f }]} />
      </Marker>
    );
  }), [punkte, sel, heft, D]);

  return (
    <View style={[st.kartenRahmen, { borderColor: c.linie }]}>
      <MapView
        ref={karte} style={StyleSheet.absoluteFill} showsUserLocation={!w.test} showsCompass={false} toolbarEnabled={false} rotateEnabled={false}
        initialRegion={{ latitude: pos ? pos.lat : 51.2, longitude: pos ? pos.lon : 10.4, latitudeDelta: pos ? 0.08 : 7, longitudeDelta: pos ? 0.08 : 7 }}>
        {punktMarker}
        {sel != null && (
          <Marker key={'sel' + sel} coordinate={{ latitude: D.lat[sel], longitude: D.lon[sel] }} anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false} zIndex={10}>
            <View style={[st.punkt, st.punktGross, { backgroundColor: PUNKT.gewaehlt }]} />
          </Marker>
        )}
        {fundPunkte.map(({ id, f, weg }) => (
          <Marker key={'f' + id} coordinate={{ latitude: f.lat, longitude: f.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}
            title={fundTitel(f)} description={'Gesammelt ' + datum(f.t) + (f.b ? ' · 🤚 berührt' : '') + (weg ? ' · 🪦 abgebaut' : '')}>
            <View style={[st.punkt, weg && st.punktGross, { backgroundColor: weg ? PUNKT.abgebaut : PUNKT.gesammelt }]} />
          </Marker>
        ))}
        {w.test && pos && (
          <Marker coordinate={{ latitude: pos.lat, longitude: pos.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={st.ich} />
          </Marker>
        )}
        {pos && sel != null && (
          <Polyline coordinates={[{ latitude: pos.lat, longitude: pos.lon }, { latitude: D.lat[sel], longitude: D.lon[sel] }]}
            strokeColor={PUNKT.gewaehlt} strokeWidth={3} lineDashPattern={[6, 8]} />
        )}
        {pos && sel != null && (
          // Pfeilspitze in der Mitte der Linie: zeigt von meinem Standort zur Anlage (Karte ist eingenordet)
          <Marker key={'weg' + sel + ':' + wegPeilung} coordinate={{ latitude: (pos.lat + D.lat[sel]) / 2, longitude: (pos.lon + D.lon[sel]) / 2 }}
            anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} tappable={false}>
            <View style={{ transform: [{ rotate: wegPeilung + 'deg' }] }}>
              <View style={[st.dreieck, { borderBottomColor: PUNKT.gewaehlt, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 18 }]} />
            </View>
          </Marker>
        )}
      </MapView>
      <NaechsteNeue />
      <Pressable onPress={zeigeFunde} accessibilityLabel="Meine Funde auf der Karte" accessibilityState={{ selected: funde }}
        style={[st.kartenKnopf, { top: 10, backgroundColor: funde ? c.gold : c.flaeche, borderColor: c.linie }]}>
        <Text style={{ fontSize: 20, color: funde ? '#fff' : c.text }}>★</Text>
      </Pressable>
      <Pressable onPress={zentriere} accessibilityLabel="Auf meinen Standort zentrieren"
        style={[st.kartenKnopf, { bottom: 10, backgroundColor: c.flaeche, borderColor: c.linie }]}>
        <Text style={{ fontSize: 22, color: c.text }}>◎</Text>
      </Pressable>
    </View>
  );
}

// Oben links auf der Karte: nächste Anlage, die man noch nicht hat, und nächste noch nicht berührte
function NaechsteNeue() {
  const w = useWind();
  const c = useFarben();
  const { D, pos, neu, unberuehrt, heading } = w;
  if (!pos) return null;
  const zeilen = neu != null && neu === unberuehrt ? [[neu, '★', 'Neu']]
    : [[neu, '★', 'Neu'], [unberuehrt, '🤚', 'Unberührt']].filter(([i]) => i != null);
  if (!zeilen.length) return null;
  return (
    <View style={st.neuBox}>
      {zeilen.map(([i, ico, text]) => {
        const a = anlage(D, i);
        const d = distanz(pos.lat, pos.lon, a.lat, a.lon);
        const b = peilung(pos.lat, pos.lon, a.lat, a.lon);
        const rel = heading == null ? b : b - heading;
        return (
          <Pressable key={text} onPress={() => w.waehle(i)} style={[st.neuZeile, { backgroundColor: c.flaeche, borderColor: c.linie }]}
            accessibilityRole="button" accessibilityLabel={text + ': ' + titel(a) + ', ' + entfernung(d) + ' Richtung ' + RICHTUNGEN[sektor(b)]}>
            <Text style={{ fontSize: 13 }}>{ico}</Text>
            <Text style={{ fontSize: 13, color: c.leise }}>{text}</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>{entfernung(d)}</Text>
            <Text style={{ fontSize: 15, fontWeight: '800', color: c.akzent, transform: [{ rotate: rel + 'deg' }] }}>↑</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Liste({ onWahl }) {
  const w = useWind();
  const c = useFarben();
  const { D, pos, nah, sel, heft } = w;
  return (
    <>
      <Abschnitt>Im Umkreis von {entfernung(w.radius)} ({fmt0.format(nah.length)})</Abschnitt>
      <View style={[st.liste, { backgroundColor: c.flaeche, borderColor: c.linie }]}>
        {!nah.length && <Leise style={{ padding: 16, textAlign: 'center' }}>Keine Anlage in diesem Umkreis – vergrößere den Radius.</Leise>}
        {nah.slice(0, LISTE_MAX).map(({ i, d }, n) => {
          const a = anlage(D, i);
          const b = peilung(pos.lat, pos.lon, a.lat, a.lon);
          const f = heft.funde[a.id];
          return (
            <Pressable key={i} onPress={() => { w.waehle(i); onWahl(); }}
              style={[st.zeile, n > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.linie }, i === sel && { backgroundColor: c.akzentHell }]}>
              <Text style={[st.pfeil, { color: c.akzent }]}>{PFEILE[sektor(b)]}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[st.zeileTitel, { color: c.text }]} numberOfLines={1}>{titel(a)}{f ? (f.b ? ' ✓🤚' : ' ✓') : ''}</Text>
                <Leise klein>{[a.park || a.name, a.ort].filter(Boolean).join(' · ') + (a.planung ? ' · geplant' : '')}</Leise>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[st.zeileDist, { color: c.text }]}>{entfernung(d)}</Text>
                <Leise klein>{KURZ[sektor(b)]}</Leise>
              </View>
            </Pressable>
          );
        })}
        {nah.length > LISTE_MAX && <Leise klein style={{ padding: 14, textAlign: 'center' }}>… und {fmt0.format(nah.length - LISTE_MAX)} weitere auf der Karte</Leise>}
      </View>
    </>
  );
}

const st = StyleSheet.create({
  inhalt: { padding: 16, paddingBottom: 40 },
  mitte: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  startTitel: { fontSize: 19, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  zielOben: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  dist: { fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  zielTitel: { fontSize: 21, fontWeight: '700', marginTop: 14, marginBottom: 2 },
  zielText: { fontSize: 15, lineHeight: 21, marginTop: 10 },
  etiketten: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  aktionen: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  dreieck: { width: 0, height: 0, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderStyle: 'solid' },
  kartenRahmen: { height: 320, borderRadius: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  neuBox: { position: 'absolute', top: 10, left: 10, gap: 6, maxWidth: '75%' },
  neuZeile: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 99, borderWidth: 1, alignSelf: 'flex-start' },
  kartenKnopf: { position: 'absolute', right: 10, width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  punkt: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  punktGross: { width: 20, height: 20, borderRadius: 10 },
  ich: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#2f7cf6', borderWidth: 3, borderColor: '#fff' },
  filter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  schalter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liste: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  zeile: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  pfeil: { width: 26, textAlign: 'center', fontSize: 18 },
  zeileTitel: { fontWeight: '600', fontSize: 16 },
  zeileDist: { fontWeight: '700', fontVariant: ['tabular-nums'] },
});
