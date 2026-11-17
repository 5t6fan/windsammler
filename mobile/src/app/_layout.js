import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WindProvider, useWind } from '../zustand';
import { useFarben } from '../farben';

export default function Layout() {
  return (
    <SafeAreaProvider>
      <WindProvider>
        <StatusBar style="auto" />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <Meldung />
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
});
