import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as Online from '../../online';
import { useWind } from '../../zustand';
import { useFarben } from '../../farben';
import { fmt0, datum } from '../../lib/format';
import { CAPTCHA_URL, DATENSCHUTZ_URL, BEDINGUNGEN_URL, WEB } from '../../config';
import { Karte, Knopf, Chips, Abschnitt, Leise } from '../../ui';

export default function Rang() {
  const o = Online.useOnline();
  if (!o.bereit) return <View style={st.mitte}><Leise>Lade …</Leise></View>;
  return (
    <ScrollView contentContainerStyle={st.inhalt} keyboardShouldPersistTaps="handled">
      {o.profil ? <Spiel /> : <Anmelden />}
    </ScrollView>
  );
}

function Links() {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
      <Link text="Datenschutz" url={DATENSCHUTZ_URL} />
      <Link text="Nutzungsbedingungen" url={BEDINGUNGEN_URL} />
    </View>
  );
}
function Link({ text, url }) {
  const c = useFarben();
  return (
    <Pressable onPress={() => Linking.openURL(url)} accessibilityRole="link" hitSlop={8}>
      <Text style={{ color: c.akzent, textDecorationLine: 'underline' }}>{text}</Text>
    </Pressable>
  );
}

/* ---------- Anmeldung mit Spielername und Sicherheitsprüfung ---------- */

function Anmelden() {
  const c = useFarben();
  const { zeige } = useWind();
  const [name, setName] = useState('');
  const [token, setToken] = useState(null);
  const [captchaNr, setCaptchaNr] = useState(0);   // erhöhen = Captcha neu laden
  const [laeuft, setLaeuft] = useState(false);

  const nachricht = (e) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.token) setToken(m.token);
      else { setToken(null); if (m.fehler) zeige('Sicherheitsprüfung: ' + m.fehler); }
    } catch (_) { /* fremde Nachricht */ }
  };

  const los = async () => {
    setLaeuft(true);
    try {
      await Online.anmelden(name, token);
      zeige('Willkommen, ' + name.trim() + '!');
    } catch (e) {
      zeige('Anmeldung fehlgeschlagen: ' + Online.fehlertext(e));
      setToken(null);
      setCaptchaNr((n) => n + 1);   // ein Token gilt nur einmal
    }
    setLaeuft(false);
  };

  return (
    <Karte style={{ alignItems: 'center', paddingVertical: 24 }}>
      <Text style={[st.titel, { color: c.text }]}>Mit Freunden um die Wette sammeln</Text>
      <Leise style={{ textAlign: 'center' }}>Wähle einen Spielernamen. Deine Gruppe sieht nur diesen Namen und deine Punkte – nie, wo du warst.</Leise>
      <TextInput
        value={name} onChangeText={setName} maxLength={24} placeholder="Spielername" placeholderTextColor={c.leise}
        autoCorrect={false} textContentType="nickname" style={[st.eingabe, { color: c.text, borderColor: c.linie, backgroundColor: c.bg, textAlign: 'center', marginTop: 14 }]} />
      <View style={st.captcha}>
        <WebView
          key={captchaNr} source={{ uri: CAPTCHA_URL }} onMessage={nachricht} style={{ backgroundColor: 'transparent' }}
          scrollEnabled={false} originWhitelist={['https://*']} setSupportMultipleWindows={false} />
      </View>
      <Knopf haupt titel={laeuft ? 'Einen Moment …' : 'Los geht’s'} disabled={!token || laeuft || name.trim().length < 2} onPress={los} style={{ alignSelf: 'stretch' }} />
      <Leise klein style={{ textAlign: 'center', marginTop: 10 }}>
        Mit „Los geht’s“ wird ein Spielerkonto angelegt und du akzeptierst die Nutzungsbedingungen. Details in der Datenschutzerklärung.
      </Leise>
      <Links />
    </Karte>
  );
}

/* ---------- Angemeldet ---------- */

function Spiel() {
  const c = useFarben();
  const { zeige } = useWind();
  const o = Online.useOnline();
  const [stand, setStand] = useState(null);
  const [zeitraum, setZeitraum] = useState('monat');
  const [versatz, setVersatz] = useState(0);
  const [zeilen, setZeilen] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [blockiert, setBlockiert] = useState([]);
  const [neuerName, setNeuerName] = useState(null);
  const [code, setCode] = useState('');
  const [gruppenName, setGruppenName] = useState('');

  const p = Online.periode(zeitraum, versatz);
  const global = o.gruppe === Online.GLOBAL;
  const g = o.gruppen.find((x) => x.id === o.gruppe);

  const ladeListe = useCallback(async () => {
    if (!o.gruppe) return;
    try {
      setZeilen(await Online.rangliste(o.gruppe, Online.periode(zeitraum, versatz)));
      setFehler(null);
    } catch (e) { setFehler(Online.fehlertext(e)); }
  }, [o.gruppe, zeitraum, versatz]);

  useEffect(() => { setZeilen(null); ladeListe(); }, [ladeListe]);

  // Beim Öffnen des Tabs: Stand, Gruppen, Blockierte und Wartendes aktualisieren
  useFocusEffect(useCallback(() => {
    Online.meinStand().then(setStand).catch(() => {});
    Online.ladeGruppen().catch(() => {});
    Online.blockierte().then((b) => setBlockiert(b || [])).catch(() => {});
    Online.sendeWarteschlange().then((r) => { if (r && r.gesendet) zeige(r.gesendet + ' Fund(e) übertragen' + (r.punkte ? ' · +' + r.punkte + ' Punkte' : '')); });
    ladeListe();
  }, [ladeListe, zeige]));

  const tu = async (fn, erfolg) => {
    try { const r = await fn(); if (erfolg) zeige(typeof erfolg === 'function' ? erfolg(r) : erfolg); return true; } catch (e) { zeige(Online.fehlertext(e)); return false; }
  };

  const einladen = () => Share.share({
    message: 'Sammle mit mir Windräder in der Gruppe „' + g.name + '“! Einladungscode: ' + g.code + '\nWindsammler: ' + WEB,
  });

  const verlassen = () => Alert.alert('Gruppe „' + g.name + '“ verlassen?', '', [
    { text: 'Abbrechen', style: 'cancel' },
    { text: 'Verlassen', style: 'destructive', onPress: () => tu(() => Online.gruppeVerlassen(g.id)) },
  ]);

  const loeschen = () => Alert.alert('Konto löschen?', 'Konto, Punkte, Bewertungen und Gruppenmitgliedschaften werden endgültig gelöscht. Dein Sammelheft auf diesem Gerät bleibt erhalten.', [
    { text: 'Abbrechen', style: 'cancel' },
    { text: 'Endgültig löschen', style: 'destructive', onPress: () => tu(Online.kontoLoeschen, 'Konto gelöscht') },
  ]);

  return (
    <View>
      <Karte style={st.ichKarte}>
        <View style={{ flex: 1 }}>
          <Leise klein>Spielername</Leise>
          {neuerName == null ? (
            <Pressable onPress={() => setNeuerName(o.profil.name)} accessibilityRole="button" accessibilityHint="Antippen zum Ändern">
              <Text style={[st.name, { color: c.text }]}>{o.profil.name} <Text style={{ fontSize: 14, color: c.leise }}>✎</Text></Text>
            </Pressable>
          ) : (
            <View style={{ flexDirection: 'row', gap: 6, marginVertical: 4 }}>
              <TextInput value={neuerName} onChangeText={setNeuerName} maxLength={24} autoFocus
                style={[st.eingabe, { flex: 1, color: c.text, borderColor: c.linie, backgroundColor: c.bg }]} />
              <Knopf titel="OK" style={{ flexGrow: 0 }} onPress={async () => { if (await tu(() => Online.umbenennen(neuerName))) setNeuerName(null); }} />
            </View>
          )}
          <Leise klein>{stand ? fmt0.format(stand.anlagen) + ' Anlagen online gewertet' : ''}</Leise>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={[st.punkte, { color: c.akzent }]}>{stand ? fmt0.format(stand.punkte) : '–'}</Text>
          <Leise klein>Punkte</Leise>
        </View>
      </Karte>
      <View style={st.schalter}>
        <Switch value={!!o.profil.global} onValueChange={(an) => tu(() => Online.globalSetzen(an),
          an ? 'Du bist jetzt in der globalen Rangliste sichtbar' : 'Du bist in der globalen Rangliste nicht mehr sichtbar')} trackColor={{ true: c.akzent }} />
        <Leise>In der globalen Rangliste zeigen</Leise>
      </View>
      {o.warte > 0 && <Text style={[st.hinweis, { color: c.text, backgroundColor: c.dunkel ? '#3a3016' : '#f6ecd6' }]}>{o.warte} {o.warte === 1 ? 'Fund wartet' : 'Funde warten'} auf Netz und wird automatisch übertragen.</Text>}

      <Abschnitt>Rangliste</Abschnitt>
      <Chips werte={[[Online.GLOBAL, '🌍 Global'], ...o.gruppen.map((x) => [x.id, x.name + ' · ' + x.mitglieder])]} wert={o.gruppe} onWahl={Online.waehleGruppe} />
      {!o.gruppen.length && <Leise klein style={{ marginTop: 8 }}>Du bist noch in keiner Gruppe. Erstelle eine oder tritt mit einem Einladungscode bei.</Leise>}

      {g && (
        <View style={st.gruppeKopf}>
          <Leise>Einladungscode <Text style={[st.code, { color: c.text }]}>{g.code}</Text></Leise>
          <Knopf titel="Einladen" onPress={einladen} style={{ flexGrow: 0 }} />
        </View>
      )}
      {global && !o.profil.global && (
        <Text style={[st.hinweis, { color: c.text, backgroundColor: c.dunkel ? '#3a3016' : '#f6ecd6', marginTop: 10 }]}>
          Die globale Rangliste zeigt alle, die sich freigeschaltet haben. Du selbst bist dort nur für dich sichtbar – schalte oben „In der globalen Rangliste zeigen“ ein, damit andere dich sehen.
        </Text>
      )}

      <View style={{ marginTop: 12 }}>
        <Chips werte={[['monat', 'Monat'], ['jahr', 'Jahr'], ['gesamt', 'Gesamt']]} wert={zeitraum} onWahl={(z) => { setZeitraum(z); setVersatz(0); }} />
      </View>
      {zeitraum !== 'gesamt' && (
        <View style={st.periode}>
          <PeriodeKnopf text="‹" label="Früherer Zeitraum" onPress={() => setVersatz(versatz + 1)} />
          <Text style={{ fontWeight: '700', color: c.text, flex: 1, textAlign: 'center' }}>{p.name}</Text>
          <PeriodeKnopf text="›" label="Späterer Zeitraum" disabled={versatz === 0} onPress={() => setVersatz(versatz - 1)} />
        </View>
      )}
      <View style={[st.liste, { backgroundColor: c.flaeche, borderColor: c.linie, marginTop: 10 }]}>
        {fehler && <Leise style={st.leer}>Rangliste nicht ladbar ({fehler})</Leise>}
        {!zeilen && !fehler && <Leise style={st.leer}>Lade …</Leise>}
        {zeilen && zeilen.map((z, n) => <Zeile key={n} z={z} erste={n === 0} />)}
        {zeilen && global && !zeilen.some((z) => !z.ich) && <Leise style={st.leer}>Noch niemand sonst ist in diesem Zeitraum global sichtbar.</Leise>}
      </View>
      {g && (
        <Pressable onPress={verlassen} style={{ paddingVertical: 12 }}>
          <Text style={{ color: c.leise, textDecorationLine: 'underline' }}>Gruppe verlassen</Text>
        </Pressable>
      )}

      <Abschnitt>Gruppe beitreten oder erstellen</Abschnitt>
      <Karte>
        <View style={st.zeileEingabe}>
          <TextInput value={code} onChangeText={setCode} maxLength={6} placeholder="CODE" placeholderTextColor={c.leise}
            autoCapitalize="characters" autoCorrect={false} style={[st.eingabe, st.codeEingabe, { color: c.text, borderColor: c.linie, backgroundColor: c.bg }]} />
          <Knopf haupt titel="Beitreten" style={{ flexGrow: 0, minWidth: 116 }}
            onPress={async () => { if (await tu(() => Online.gruppeBeitreten(code), (r) => 'Willkommen in „' + r.name + '“')) setCode(''); }} />
        </View>
        <View style={[st.zeileEingabe, { marginTop: 8 }]}>
          <TextInput value={gruppenName} onChangeText={setGruppenName} maxLength={40} placeholder="Name der neuen Gruppe" placeholderTextColor={c.leise}
            style={[st.eingabe, { flex: 1, color: c.text, borderColor: c.linie, backgroundColor: c.bg }]} />
          <Knopf titel="Erstellen" style={{ flexGrow: 0, minWidth: 116 }}
            onPress={async () => { if (await tu(() => Online.gruppeErstellen(gruppenName), (r) => 'Gruppe erstellt – Code ' + r.code)) setGruppenName(''); }} />
        </View>
      </Karte>

      <Abschnitt>Punkte</Abschnitt>
      <Karte>
        {[['Jede Anlage', '+1'], ['Neues Modell', '+5'], ['Neue Marke', '+10'], ['Seltenes Modell (≤ 20 in Deutschland)', '+20'],
          ['Als Erste/r überhaupt gesammelt', '+3'], ['Turm berührt (unter 20 m)', '+2']].map(([t, p_], n) => (
          <View key={t} style={[st.regel, n > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.linie }]}>
            <Text style={{ color: c.text, flex: 1 }}>{t}</Text>
            <Text style={{ color: c.akzent, fontWeight: '700' }}>{p_}</Text>
          </View>
        ))}
        <Leise klein style={{ marginTop: 10 }}>Gewertet werden Funde, die du nach der Anmeldung sammelst. Der Server prüft, dass du wirklich in der Nähe der Anlage warst – deine Position wird dabei nicht gespeichert.</Leise>
      </Karte>

      <Abschnitt>Blockierte Spieler</Abschnitt>
      <View style={[st.liste, { backgroundColor: c.flaeche, borderColor: c.linie }]}>
        {!blockiert.length && <Leise style={st.leer}>Du hast niemanden blockiert.</Leise>}
        {blockiert.map((b, n) => (
          <View key={b.id} style={[st.zeile, n > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.linie }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: c.text }}>{b.name}</Text>
              <Leise klein>blockiert am {datum(Date.parse(b.zeit))}</Leise>
            </View>
            <Knopf titel="Aufheben" style={{ flexGrow: 0 }}
              onPress={async () => { if (await tu(() => Online.entblocken(b.id))) setBlockiert(blockiert.filter((x) => x.id !== b.id)); }} />
          </View>
        ))}
      </View>

      <Pressable onPress={loeschen} style={{ paddingVertical: 14 }}>
        <Text style={{ color: c.leise, textDecorationLine: 'underline' }}>Konto löschen</Text>
      </Pressable>
      <Links />
    </View>
  );
}

function PeriodeKnopf({ text, label, onPress, disabled }) {
  const c = useFarben();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label}
      style={[st.periodeKnopf, { borderColor: c.linie, backgroundColor: c.flaeche }, disabled && { opacity: 0.35 }]}>
      <Text style={{ fontSize: 20, color: c.text }}>{text}</Text>
    </Pressable>
  );
}

function Zeile({ z, erste }) {
  const c = useFarben();
  const medaille = z.punkte > 0 ? ({ 1: '🥇', 2: '🥈', 3: '🥉' }[z.platz] || String(z.platz)) : String(z.platz);
  const unter = [fmt0.format(z.anlagen) + ' Anlagen', fmt0.format(z.modelle) + ' Modelle'];
  if (Number(z.beruehrt)) unter.push(fmt0.format(z.beruehrt) + ' 🤚');
  return (
    <View style={[st.zeile, !erste && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.linie }, z.ich && { backgroundColor: c.akzentHell }]}>
      <Text style={[st.platz, { color: c.leise }]}>{medaille}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600', color: c.text, fontSize: 16 }} numberOfLines={1}>{z.name}{z.ich ? ' (du)' : ''}</Text>
        <Leise klein>{unter.join(' · ')}</Leise>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>{fmt0.format(z.punkte)}</Text>
        <Leise klein>Punkte</Leise>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  inhalt: { padding: 16, paddingBottom: 40 },
  mitte: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  titel: { fontSize: 19, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  eingabe: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, alignSelf: 'stretch' },
  captcha: { height: 80, alignSelf: 'stretch', marginVertical: 12 },
  ichKarte: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 21, fontWeight: '700' },
  punkte: { fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  schalter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 4, marginBottom: 8 },
  hinweis: { borderRadius: 12, padding: 12, fontSize: 14, overflow: 'hidden' },
  gruppeKopf: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 8 },
  code: { fontWeight: '700', fontSize: 18, letterSpacing: 2, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  periode: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  periodeKnopf: { width: 44, height: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  liste: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  leer: { padding: 16, textAlign: 'center' },
  zeile: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  platz: { width: 32, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  zeileEingabe: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  codeEingabe: { flex: 1, letterSpacing: 3, textTransform: 'uppercase' },
  regel: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
});
