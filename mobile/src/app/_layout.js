import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
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

// Kurze Rückmeldung über der Tableiste (wie der Toast der Web-App)
function Meldung() {
  const { meldung } = useWind();
  const c = useFarben();
  const rand = useSafeAreaInsets();
  if (!meldung) return null;
  return (
    <View pointerEvents="none" style={[st.meldung, { bottom: rand.bottom + 64, backgroundColor: c.text }]} accessibilityLiveRegion="polite">
      <Text style={[st.text, { color: c.bg }]}>{meldung}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  meldung: { position: 'absolute', left: 24, right: 24, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  text: { fontWeight: '600', textAlign: 'center', fontSize: 15 },
});
