// Kleine Bausteine der Oberfläche: Karte, Knopf, Chip, Abschnitt, Etikett, Fortschritt, Blatt (Modal)
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFarben } from './farben';

export function Karte({ children, style }) {
  const c = useFarben();
  return <View style={[s.karte, { backgroundColor: c.flaeche, borderColor: c.linie }, style]}>{children}</View>;
}

export function Knopf({ titel, onPress, haupt, disabled, style }) {
  const c = useFarben();
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [s.knopf, { backgroundColor: haupt ? c.akzent : c.flaeche, borderColor: haupt ? c.akzent : c.linie },
        disabled && { opacity: 0.45 }, pressed && { opacity: 0.75 }, style]}>
      <Text style={[s.knopfText, { color: haupt ? c.akzentText : c.text }]} numberOfLines={2}>{titel}</Text>
    </Pressable>
  );
}

export function Chips({ werte, wert, onWahl }) {
  const c = useFarben();
  return (
    <View style={s.chips}>
      {werte.map(([k, text]) => {
        const an = k === wert;
        return (
          <Pressable key={k} onPress={() => onWahl(k)} accessibilityRole="button" accessibilityState={{ selected: an }}
            style={[s.chip, { backgroundColor: an ? c.akzent : c.flaeche, borderColor: an ? c.akzent : c.linie }]}>
            <Text style={[s.chipText, { color: an ? c.akzentText : c.text }]}>{text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Abschnitt({ children }) {
  const c = useFarben();
  return <Text style={[s.abschnitt, { color: c.leise }]}>{children}</Text>;
}

export function Leise({ children, klein, style }) {
  const c = useFarben();
  return <Text style={[{ color: c.leise, fontSize: klein ? 13 : 15 }, style]}>{children}</Text>;
}

export function Etikett({ text, art }) {
  const c = useFarben();
  const stil = {
    gesammelt: { backgroundColor: c.akzent, color: c.akzentText },
    planung: { borderWidth: 1, borderStyle: 'dashed', borderColor: c.planung, color: c.leise },
    selten: { backgroundColor: c.dunkel ? '#4a3a12' : '#f3e4c4', color: c.text },
    offen: { borderWidth: 1, borderStyle: 'dashed', borderColor: c.linie, color: c.leise },
    normal: { backgroundColor: c.akzentHell, color: c.text },
  }[art || 'normal'];
  return <Text style={[s.etikett, stil]}>{text}</Text>;
}

export function Fortschritt({ wert, gesamt }) {
  const c = useFarben();
  const p = gesamt ? Math.round((100 * wert) / gesamt) : 0;
  return (
    <View style={[s.balken, { backgroundColor: c.linie }]} accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: gesamt, now: wert }}>
      <View style={{ width: p + '%', height: '100%', backgroundColor: c.akzent, borderRadius: 99 }} />
    </View>
  );
}

// Blatt von unten (Details zu Abzeichen, Quartetten)
export function Blatt({ titel, sichtbar, onZu, children }) {
  const c = useFarben();
  const rand = useSafeAreaInsets();
  return (
    <Modal visible={sichtbar} animationType="slide" presentationStyle="pageSheet" onRequestClose={onZu}>
      <View style={[s.blatt, { backgroundColor: c.flaeche }]}>
        <View style={s.blattKopf}>
          <Text style={[s.blattTitel, { color: c.text }]}>{titel}</Text>
          <Pressable onPress={onZu} accessibilityLabel="Schließen" hitSlop={10}
            style={[s.zu, { borderColor: c.linie, backgroundColor: c.bg }]}>
            <Text style={{ color: c.text, fontSize: 16 }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: rand.bottom + 24 }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export const s = StyleSheet.create({
  karte: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, marginBottom: 12 },
  knopf: { minHeight: 46, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  knopfText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 99, borderWidth: 1, justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '600' },
  abschnitt: { fontSize: 14, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 8, marginHorizontal: 4 },
  etikett: { fontSize: 12, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, overflow: 'hidden' },
  balken: { height: 6, borderRadius: 99, overflow: 'hidden', marginTop: 8 },
  blatt: { flex: 1, paddingHorizontal: 16 },
  blattKopf: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, gap: 8 },
  blattTitel: { fontSize: 20, fontWeight: '700', flex: 1 },
  zu: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
