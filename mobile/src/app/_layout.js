import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Keyboard, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WindProvider, useWind } from '../zustand';
import { useFarben } from '../farben';
// Registriert die Hintergrund-Aufgabe – muss beim Start geladen werden, auch wenn das System die App nur im Hintergrund weckt
import '../hintergrund';
import { Blatt, Knopf, Leise } from '../ui';
import { BEDINGUNGEN_URL } from '../config';

export default function Layout() {
  return (
    <SafeAreaProvider>
      <WindProvider>
        <StatusBar style="auto" />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <Meldung />
        <Sicherheit />
      </WindProvider>
    </SafeAreaProvider>
  );
}

// Kurze Rückmeldung über der Tableiste (wie der Toast der Web-App) – bei offener Tastatur direkt darüber
function Meldung() {
  const { meldung } = useWind();
  const c = useFarben();
  const rand = useSafeAreaInsets();
  const tastatur = useTastaturHoehe();
  if (!meldung) return null;
  const unten = tastatur ? tastatur + 12 : rand.bottom + 64;
  return (
    <View pointerEvents="none" style={[st.meldung, { bottom: unten, backgroundColor: c.text }]} accessibilityLiveRegion="polite">
      <Text style={[st.text, { color: c.bg }]}>{meldung}</Text>
    </View>
  );
}

// Sicherheitshinweis: vor dem ersten Start der Standortsuche bestätigen, danach jederzeit wieder aufrufbar
const PUNKTE = [
  'Betritt nur frei zugängliche Wege und Flächen. Beachte Absperrungen, Schilder und Anweisungen von Betreibern, Landwirten und Jägern.',
  'Halte großen Abstand bei Frost (Eiswurf von den Rotorblättern), Gewitter, Sturm sowie bei Bau- und Wartungsarbeiten.',
  'Klettere nicht auf Anlagen, Zäune oder Bauteile. „Turm berühren“ nur, wo der Turm frei und gefahrlos erreichbar ist.',
  'Bediene die App nicht beim Fahren und achte auf den Verkehr.',
  'Standorte aus dem Marktstammdatenregister können ungenau sein.',
];

function Sicherheit() {
  const w = useWind();
  const c = useFarben();
  const offen = !!w.sicherheitOffen;
  const verstanden = () => {
    const starten = w.sicherheitOffen === 'start';
    w.bestaetigeSicherheit();
    if (starten) w.starteStandort();
  };
  return (
    <Blatt titel="⚠️ Sicherheit geht vor" sichtbar={offen} onZu={() => w.setSicherheitOffen(false)}>
      <Text style={[st.absatz, { color: c.text }]}>Windparks sind Betriebsgelände und liegen meist auf Privatgrund.</Text>
      {PUNKTE.map((p) => (
        <View key={p} style={st.punktZeile}>
          <Text style={{ color: c.text, fontSize: 15 }}>•</Text>
          <Text style={[st.absatz, { color: c.text, flex: 1, marginVertical: 0 }]}>{p}</Text>
        </View>
      ))}
      <Text style={[st.absatz, { color: c.text }]}>
        <Text style={{ fontWeight: '700' }}>Die Suche nach Windenergieanlagen und das Betreten von Windparkflächen erfolgen auf eigene Gefahr. </Text>
        Für Unfälle, Schäden oder Verstöße, die bei der Suche oder vor Ort entstehen, übernehmen wir im gesetzlich zulässigen
        Rahmen keine Verantwortung. Punkte und Abzeichen sind kein Grund, Risiken einzugehen.
      </Text>
      <Pressable onPress={() => Linking.openURL(BEDINGUNGEN_URL)} accessibilityRole="link">
        <Leise klein style={{ textDecorationLine: 'underline', marginBottom: 16 }}>Mehr in den Nutzungsbedingungen</Leise>
      </Pressable>
      <Knopf haupt titel="Verstanden" onPress={verstanden} />
    </Blatt>
  );
}

function useTastaturHoehe() {
  const [hoehe, setHoehe] = useState(0);
  useEffect(() => {
    // iOS meldet die Tastatur schon beim Einblenden, Android erst danach
    const auf = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHoehe(e.endCoordinates.height));
    const zu = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setHoehe(0));
    return () => { auf.remove(); zu.remove(); };
  }, []);
  return hoehe;
}

const st = StyleSheet.create({
  meldung: { position: 'absolute', left: 24, right: 24, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  text: { fontWeight: '600', textAlign: 'center', fontSize: 15 },
  absatz: { fontSize: 15, lineHeight: 21, marginVertical: 8 },
  punktZeile: { flexDirection: 'row', gap: 8, marginVertical: 4 },
});
