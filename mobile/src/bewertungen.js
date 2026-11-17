// Bewertungen einer Anlage in der Zielkarte. Lesen: alle angemeldeten Spieler.
// Schreiben: nur wer die Anlage mit seinem Konto gesammelt hat (prüft der Server).
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Online from './online';
import { useFarben } from './farben';
import { datum } from './lib/format';
import { Knopf, Leise } from './ui';

const sterneText = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

export function Entdecker({ id }) {
  const { profil } = Online.useOnline();
  const c = useFarben();
  const [e, setE] = useState(null);
  useEffect(() => {
    let aktuell = true;
    setE(null);
    if (profil) Online.entdecker(id).then((x) => aktuell && setE(x));
    return () => { aktuell = false; };
  }, [id, profil]);
  if (!e) return null;
  return <Text style={{ marginTop: 8, fontWeight: '600', color: c.text }}>🚩 Erstentdeckt von {e.ich ? 'dir' : e.name} am {datum(Date.parse(e.zeit))}</Text>;
}

export function Bewertungen({ id, gesammelt, zeige }) {
  const { profil } = Online.useOnline();
  const c = useFarben();
  const [offen, setOffen] = useState(false);
  const [zeilen, setZeilen] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [sterne, setSterne] = useState(0);
  const [text, setText] = useState('');

  const lade = async (neu) => {
    try {
      const z = await Online.kommentare(id, neu);
      setZeilen(z);
      setFehler(null);
      const eigene = z.find((x) => x.ich);
      setSterne(eigene ? eigene.sterne : 0);
      setText(eigene ? eigene.text : '');
    } catch (e) {
      setFehler(Online.fehlertext(e));
    }
  };

  useEffect(() => {
    setOffen(false); setZeilen(null); setSterne(0); setText('');
    if (profil) lade(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, profil]);

  if (!profil) return null;

  const eigene = zeilen && zeilen.find((x) => x.ich);
  const schnitt = zeilen && zeilen.length ? zeilen.reduce((s, x) => s + x.sterne, 0) / zeilen.length : 0;

  const aktion = async (fn, erfolg) => {
    try { await fn(); if (erfolg) zeige(erfolg); } catch (e) { zeige(Online.fehlertext(e)); return; }
    lade(true);
  };
  const speichern = () => {
    if (!sterne) return zeige('Bitte 1 bis 5 Sterne wählen');
    aktion(() => Online.kommentarSpeichern(id, sterne, text), 'Bewertung gespeichert');
  };
  const loeschen = () => Alert.alert('Bewertung löschen?', '', [
    { text: 'Abbrechen', style: 'cancel' },
    { text: 'Löschen', style: 'destructive', onPress: () => aktion(() => Online.kommentarLoeschen(id), 'Bewertung gelöscht') },
  ]);
  const optionen = (x) => Alert.alert(x.name, 'Was möchtest du tun?', [
    ...(x.gemeldet ? [] : [{ text: 'Kommentar melden', onPress: () => aktion(() => Online.kommentarMelden(x.id), 'Danke, gemeldet') }]),
    { text: 'Spieler blockieren', style: 'destructive', onPress: () => Alert.alert(
      '„' + x.name + '“ blockieren?', 'Du siehst dann keine Kommentare dieser Person mehr. Aufheben kannst du das im Tab Rangliste.', [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Blockieren', style: 'destructive', onPress: () => aktion(() => Online.blockieren(x.id), 'Blockiert') },
      ]) },
    { text: 'Abbrechen', style: 'cancel' },
  ]);

  return (
    <View style={[st.box, { borderTopColor: c.linie }]}>
      <Pressable onPress={() => setOffen(!offen)} style={st.kopf} accessibilityRole="button" accessibilityState={{ expanded: offen }}>
        <Text style={{ fontWeight: '600', color: c.text, fontSize: 16 }}>💬 Bewertungen {offen ? '⌄' : '›'}</Text>
        <Leise klein>{zeilen == null ? '' : zeilen.length ? '★ ' + schnitt.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' · ' + zeilen.length : 'noch keine'}</Leise>
      </Pressable>
      {offen && (
        <View>
          {fehler && <Leise klein>Bewertungen nicht ladbar ({fehler})</Leise>}
          {zeilen && !zeilen.length && <Leise klein style={{ marginTop: 6 }}>Noch keine Bewertungen – sei die/der Erste.</Leise>}
          {zeilen && zeilen.map((x) => (
            <View key={x.id} style={[st.eintrag, { borderTopColor: c.linie }, x.ich && { backgroundColor: c.akzentHell, borderRadius: 10, paddingHorizontal: 8 }]}>
              <View style={st.zeile}>
                <Text style={{ fontWeight: '700', color: c.text, flex: 1 }} numberOfLines={1}>{x.name}{x.ich ? ' (du)' : ''}</Text>
                <Text style={{ color: c.gold, letterSpacing: 1 }} accessibilityLabel={x.sterne + ' von 5 Sternen'}>{sterneText(x.sterne)}</Text>
              </View>
              {!!x.text && <Text style={{ color: c.text, marginVertical: 4 }}>{x.text}</Text>}
              <View style={st.zeile}>
                <Leise klein>{datum(Date.parse(x.zeit))}{x.gemeldet ? ' · gemeldet' : ''}</Leise>
                {!x.ich && (
                  <Pressable onPress={() => optionen(x)} hitSlop={8} accessibilityLabel={'Optionen für den Kommentar von ' + x.name}>
                    <Text style={{ color: c.leise, textDecorationLine: 'underline', fontSize: 13 }}>Melden / Blockieren</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ))}
          {gesammelt ? (
            <View style={{ marginTop: 10 }}>
              <View style={st.zeile} accessibilityRole="radiogroup">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setSterne(n)} accessibilityRole="radio" accessibilityState={{ checked: n === sterne }}
                    accessibilityLabel={n + ' Sterne'} style={[st.stern, { borderColor: n <= sterne ? c.gold : c.linie }]}>
                    <Text style={{ fontSize: 22, color: n <= sterne ? c.gold : c.linie }}>★</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={text} onChangeText={setText} maxLength={500} multiline placeholder="Wie war’s an dieser Anlage? (optional)"
                placeholderTextColor={c.leise} style={[st.eingabe, { color: c.text, borderColor: c.linie, backgroundColor: c.bg }]} />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Knopf haupt titel={eigene ? 'Ändern' : 'Bewerten'} onPress={speichern} />
                {eigene && <Knopf titel="Löschen" onPress={loeschen} />}
              </View>
            </View>
          ) : (
            <Leise klein style={{ marginTop: 8 }}>Bewerten kannst du, sobald du die Anlage gesammelt hast.</Leise>
          )}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  box: { marginTop: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  kopf: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
  eintrag: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  zeile: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  stern: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  eingabe: { minHeight: 72, borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 8, fontSize: 16, textAlignVertical: 'top' },
});
