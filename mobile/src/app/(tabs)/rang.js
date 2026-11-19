import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as Online from '../../online';
import { useWind } from '../../zustand';
import { useFarben } from '../../farben';
import { fmt, fmt0, datum } from '../../lib/format';
import { ABZEICHEN } from '../../lib/spiel';
import { CAPTCHA_URL, DATENSCHUTZ_URL, BEDINGUNGEN_URL, WEB } from '../../config';
import { Karte, Knopf, Chips, Abschnitt, Leise, Blatt } from '../../ui';

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
  const [passwort, setPasswort] = useState('');
  const [mitPasswort, setMitPasswort] = useState(false);   // false = neues Konto, true = mit Passwort anmelden
  const [token, setToken] = useState(null);
  const [captchaNr, setCaptchaNr] = useState(0);   // erhöhen = Captcha neu laden
  const [laeuft, setLaeuft] = useState(false);
  const [sitzung, setSitzung] = useState(false);   // Konto schon angelegt, nur der Name fehlt noch
  const [fehler, setFehler] = useState(null);       // Hinweis direkt unter dem Namensfeld
  useEffect(() => { Online.hatSitzung().then(setSitzung); }, []);

  const nachricht = (e) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.token) setToken(m.token);
      else { setToken(null); if (m.fehler) zeige('Sicherheitsprüfung: ' + m.fehler); }
    } catch (_) { /* fremde Nachricht */ }
  };

  const los = async () => {
    setLaeuft(true);
    setFehler(null);
    try {
      if (mitPasswort) zeige('Willkommen zurück, ' + await Online.anmeldenMitPasswort(name, passwort, token) + '!');
      else {
        await Online.anmelden(name, token);
        zeige('Willkommen, ' + name.trim() + '!');
      }
    } catch (e) {
      setFehler(Online.fehlertext(e));
      if (await Online.hatSitzung()) setSitzung(true);
      else { setToken(null); setCaptchaNr((n) => n + 1); }   // ein Token gilt nur einmal
    }
    setLaeuft(false);
  };

  return (
    <Karte style={{ alignItems: 'center', paddingVertical: 24 }}>
      <Text style={[st.titel, { color: c.text }]}>Mit Freunden um die Wette sammeln</Text>
      <Leise style={{ textAlign: 'center' }}>
        {mitPasswort
          ? 'Melde dich mit Spielername und dem Passwort an, das du in deinem Konto festgelegt hast. Punkte, Gruppen und Bewertungen kommen mit.'
          : 'Wähle einen Spielernamen. Deine Gruppe sieht nur diesen Namen und deine Punkte – nie, wo du warst.'}
      </Leise>
      <TextInput
        value={name} onChangeText={(t) => { setName(t); setFehler(null); }} maxLength={24} placeholder="Spielername" placeholderTextColor={c.leise}
        autoCorrect={false} autoCapitalize="none" textContentType={mitPasswort ? 'username' : 'nickname'} accessibilityHint={fehler || undefined}
        style={[st.eingabe, { color: c.text, borderColor: fehler ? c.gewaehlt : c.linie, backgroundColor: c.bg, textAlign: 'center', marginTop: 14 }]} />
      {mitPasswort && <TextInput
        value={passwort} onChangeText={(t) => { setPasswort(t); setFehler(null); }} maxLength={72} placeholder="Passwort" placeholderTextColor={c.leise}
        secureTextEntry autoCorrect={false} autoCapitalize="none" textContentType="password" autoComplete="current-password"
        style={[st.eingabe, { color: c.text, borderColor: fehler ? c.gewaehlt : c.linie, backgroundColor: c.bg, textAlign: 'center', marginTop: 10 }]} />}
      {fehler && <Text style={[st.feldFehler, { color: c.gewaehlt }]} accessibilityLiveRegion="polite">{fehler}</Text>}
      {!sitzung && <View style={st.captcha}>
        <WebView
          key={captchaNr} source={{ uri: CAPTCHA_URL }} onMessage={nachricht} style={{ backgroundColor: 'transparent' }}
          scrollEnabled={false} setSupportMultipleWindows={false}
          // Turnstile lädt seine Prüfung in innere Rahmen (about:srcdoc, challenges.cloudflare.com) –
          // die müssen erlaubt sein. Die Seite selbst darf nirgendwohin wegnavigieren.
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(r) => r.isTopFrame === false || r.url.startsWith(CAPTCHA_URL) || r.url.startsWith('about:')} />
      </View>}
      {sitzung && <View style={{ height: 12 }} />}
      <Knopf haupt titel={laeuft ? 'Einen Moment …' : mitPasswort ? 'Anmelden' : 'Los geht’s'}
        disabled={(!token && !sitzung) || laeuft || name.trim().length < 2 || (mitPasswort && !passwort)} onPress={los} style={{ alignSelf: 'stretch' }} />
      <Pressable onPress={() => { setMitPasswort(!mitPasswort); setFehler(null); }} accessibilityRole="button" hitSlop={8} style={{ paddingVertical: 12 }}>
        <Text style={{ color: c.leise, textDecorationLine: 'underline' }}>{mitPasswort ? 'Neu hier? Spielerkonto anlegen' : 'Schon ein Konto? Mit Passwort anmelden'}</Text>
      </Pressable>
      {!mitPasswort && <Leise klein style={{ textAlign: 'center' }}>
        Mit „Los geht’s“ wird ein Spielerkonto angelegt und du akzeptierst die Nutzungsbedingungen. Details in der Datenschutzerklärung.
      </Leise>}
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
  const [profil, setProfil] = useState(null);   // angetipptes Spielerprofil
  const [neuerName, setNeuerName] = useState(null);
  const [namensFehler, setNamensFehler] = useState(null);
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
              <TextInput value={neuerName} onChangeText={(t) => { setNeuerName(t); setNamensFehler(null); }} maxLength={24} autoFocus
                style={[st.eingabe, { flex: 1, color: c.text, borderColor: namensFehler ? c.gewaehlt : c.linie, backgroundColor: c.bg }]} />
              <Knopf titel="OK" style={{ flexGrow: 0 }} onPress={async () => {
                try { await Online.umbenennen(neuerName); setNeuerName(null); setNamensFehler(null); } catch (e) { setNamensFehler(Online.fehlertext(e)); }
              }} />
            </View>
          )}
          {neuerName != null && namensFehler && <Text style={[st.feldFehler, { color: c.gewaehlt, textAlign: 'left' }]} accessibilityLiveRegion="polite">{namensFehler}</Text>}
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
      <KontoSichern />
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
        {zeilen && zeilen.map((z, n) => <Zeile key={n} z={z} erste={n === 0}
          onPress={() => Online.spielerProfil(z.name).then(setProfil).catch((e) => zeige('Profil nicht ladbar: ' + Online.fehlertext(e)))} />)}
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
          ['Als Erste/r überhaupt gesammelt', '+3'], ['Turm berührt (unter 20 m)', '+2'], ['Als Erste/r überhaupt berührt', '+3']].map(([t, p_], n) => (
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
      <Profil p={profil} onZu={() => setProfil(null)} />
    </View>
  );
}

/* ---------- Passwort festlegen, damit sich das Konto auf anderen Geräten wiederherstellen lässt ---------- */

function KontoSichern() {
  const c = useFarben();
  const { zeige } = useWind();
  const o = Online.useOnline();
  const [pw, setPw] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  if (o.hatPasswort === null) return null;
  const speichern = async () => {
    setLaeuft(true);
    try {
      await Online.passwortSetzen(pw);
      setPw('');
      zeige('Passwort gespeichert – anmelden kannst du dich jetzt mit „' + o.profil.name + '“ und diesem Passwort');
    } catch (e) { zeige(Online.fehlertext(e)); }
    setLaeuft(false);
  };
  return (
    <Karte style={[{ marginBottom: 10 }, !o.hatPasswort && { backgroundColor: c.dunkel ? '#3a3016' : '#f6ecd6' }]}>
      <Text style={{ fontWeight: '700', color: c.text }}>{o.hatPasswort ? 'Passwort ändern' : '⚠️ Konto sichern'}</Text>
      <Leise klein style={{ marginTop: 4, marginBottom: 10 }}>
        {o.hatPasswort
          ? 'Dein Konto ist mit einem Passwort gesichert. Auf einem anderen Gerät oder nach einer Neuinstallation: „Mit Passwort anmelden“ mit deinem Spielernamen.'
          : 'Dein Konto hängt nur an dieser App-Installation. Lege ein Passwort fest, damit du dich nach einer Neuinstallation oder auf einem anderen Gerät (auch in der Web-App) wieder anmelden kannst.'}
      </Leise>
      <View style={st.zeileEingabe}>
        <TextInput value={pw} onChangeText={setPw} maxLength={72} placeholder="Neues Passwort (mind. 6 Zeichen)" placeholderTextColor={c.leise}
          secureTextEntry autoCorrect={false} autoCapitalize="none" textContentType="newPassword" autoComplete="new-password"
          style={[st.eingabe, { flex: 1, color: c.text, borderColor: c.linie, backgroundColor: c.bg }]} />
        <Knopf haupt titel={laeuft ? '…' : 'Speichern'} disabled={laeuft || pw.length < 6} onPress={speichern} style={{ flexGrow: 0 }} />
      </View>
    </Karte>
  );
}

/* ---------- Spielerprofil (aus der Rangliste angetippt) ---------- */

function Profil({ p, onZu }) {
  const c = useFarben();
  const abz = p ? ABZEICHEN.filter((a) => p.abzeichen.includes(a.k)) : [];
  const zahlen = p ? [
    [fmt0.format(p.punkte), 'Punkte'], [fmt0.format(p.anlagen), 'Anlagen'], [fmt0.format(p.hersteller), 'Hersteller'],
    [fmt0.format(p.modelle), 'Modelle'], [fmt.format(p.kw / 1000), 'MW'], [fmt0.format(p.beruehrt), '🤚 berührt'],
  ] : [];
  return (
    <Blatt titel={p ? '👤 ' + p.name + (p.ich ? ' (du)' : '') : ''} sichtbar={!!p} onZu={onZu}>
      {p && <View>
        <Leise klein>Dabei seit {datum(Date.parse(p.seit))}</Leise>
        <View style={[st.raster, { marginTop: 10 }]}>
          {zahlen.map(([z, t]) => (
            <View key={t} style={[st.zahl, { backgroundColor: c.bg, borderColor: c.linie }]}>
              <Text style={{ fontSize: 22, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>{z}</Text>
              <Leise klein>{t}</Leise>
            </View>
          ))}
        </View>
        <Abschnitt>Abzeichen · {abz.length}</Abschnitt>
        {abz.length === 0 && <Leise>Noch keine Abzeichen.</Leise>}
        <View style={st.raster}>
          {abz.map((a) => (
            <View key={a.k} style={[st.zahl, { backgroundColor: c.bg, borderColor: c.linie }]} accessible accessibilityLabel={a.name + ': ' + a.text}>
              <Text style={{ fontSize: 26 }}>{a.ico}</Text>
              <Text style={{ fontWeight: '600', fontSize: 13, color: c.text, textAlign: 'center' }}>{a.name}</Text>
              <Leise klein style={{ textAlign: 'center' }}>{a.text}</Leise>
            </View>
          ))}
        </View>
        {p.marken.length > 0 && <Abschnitt>Hersteller</Abschnitt>}
        {p.marken.map((m) => (
          <Text key={m.marke} style={{ color: c.text, paddingVertical: 3 }}>
            • <Text style={{ fontWeight: '600' }}>{m.marke}</Text> · {fmt0.format(m.anlagen)} Anlage{m.anlagen === 1 ? '' : 'n'} · {fmt0.format(m.modelle)} Modell{m.modelle === 1 ? '' : 'e'}
          </Text>
        ))}
        {p.raritaeten.length > 0 && <Abschnitt>💎 Raritäten</Abschnitt>}
        {p.raritaeten.map((r) => <Text key={r} style={{ color: c.text, paddingVertical: 3 }}>• {r}</Text>)}
        <Leise klein style={{ marginTop: 16 }}>
          Gezählt werden die online gewerteten Funde. Wo und wann gesammelt wurde, ist nicht sichtbar. Manche Abzeichen aus dem Sammelheft (z. B. Park komplett, Kuhkratzer) zählen hier nicht mit.
        </Leise>
      </View>}
    </Blatt>
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

function Zeile({ z, erste, onPress }) {
  const c = useFarben();
  const medaille = z.punkte > 0 ? ({ 1: '🥇', 2: '🥈', 3: '🥉' }[z.platz] || String(z.platz)) : String(z.platz);
  const unter = [fmt0.format(z.anlagen) + ' Anlagen', fmt0.format(z.modelle) + ' Modelle'];
  if (Number(z.beruehrt)) unter.push(fmt0.format(z.beruehrt) + ' 🤚');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint="Profil anzeigen"
      style={({ pressed }) => [st.zeile, !erste && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.linie }, z.ich && { backgroundColor: c.akzentHell }, pressed && { opacity: 0.6 }]}>
      <Text style={[st.platz, { color: c.leise }]}>{medaille}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600', color: c.text, fontSize: 16 }} numberOfLines={1}>{z.name}{z.ich ? ' (du)' : ''}</Text>
        <Leise klein>{unter.join(' · ')}</Leise>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>{fmt0.format(z.punkte)}</Text>
        <Leise klein>Punkte</Leise>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  inhalt: { padding: 16, paddingBottom: 40 },
  mitte: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  titel: { fontSize: 19, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  feldFehler: { fontSize: 14, fontWeight: '600', marginTop: 6, textAlign: 'center', alignSelf: 'stretch' },
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
  raster: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  zahl: { width: '31.5%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center' },
  zeile: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  platz: { width: 32, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  zeileEingabe: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  codeEingabe: { flex: 1, letterSpacing: 3, textTransform: 'uppercase' },
  regel: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
});
