import { ScrollView, Text } from 'react-native';
import { useFarben } from '../../farben';
import { Karte, Leise } from '../../ui';

// Platzhalter: Rangliste, Gruppen und Bewertungen folgen im nächsten Schritt (gleiche Supabase wie die Web-App)
export default function Rang() {
  const c = useFarben();
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Karte style={{ alignItems: 'center', paddingVertical: 24 }}>
        <Text style={{ fontSize: 40 }}>🏆</Text>
        <Text style={{ fontSize: 19, fontWeight: '700', color: c.text, marginVertical: 8, textAlign: 'center' }}>Rangliste kommt bald</Text>
        <Leise style={{ textAlign: 'center' }}>
          Gruppen, globale Rangliste und Bewertungen folgen in der nächsten Version der App. Bis dahin findest du sie in der Web-App.
        </Leise>
      </Karte>
    </ScrollView>
  );
}
