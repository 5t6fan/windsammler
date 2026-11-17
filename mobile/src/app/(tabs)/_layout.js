import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useFarben } from '../../farben';
import { useWind } from '../../zustand';
import { fmt0, datum } from '../../lib/format';

const Symbol = ({ zeichen, an }) => <Text style={{ fontSize: 22, opacity: an ? 1 : 0.55 }}>{zeichen}</Text>;

export default function TabLayout() {
  const c = useFarben();
  const { D, ladeFehler } = useWind();
  const status = ladeFehler ? 'Daten nicht ladbar' : D ? fmt0.format(D.n) + ' Anlagen · Stand ' + datum(D.meta.datenstand) : 'Lade Daten …';
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.akzent,
        tabBarInactiveTintColor: c.leise,
        tabBarStyle: { backgroundColor: c.flaeche, borderTopColor: c.linie },
        headerStyle: { backgroundColor: c.bg },
        headerTitleStyle: { color: c.text, fontWeight: '700' },
        headerShadowVisible: false,
        headerRight: () => <Text style={{ color: c.leise, fontSize: 12, marginRight: 16 }}>{status}</Text>,
        sceneStyle: { backgroundColor: c.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'In der Nähe', headerTitle: 'Windsammler', tabBarIcon: ({ focused }) => <Symbol zeichen="🧭" an={focused} /> }} />
      <Tabs.Screen name="heft" options={{ title: 'Sammelheft', tabBarIcon: ({ focused }) => <Symbol zeichen="📒" an={focused} /> }} />
      <Tabs.Screen name="rang" options={{ title: 'Rangliste', tabBarIcon: ({ focused }) => <Symbol zeichen="🏆" an={focused} /> }} />
    </Tabs>
  );
}
