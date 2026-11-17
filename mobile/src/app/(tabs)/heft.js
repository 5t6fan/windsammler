import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useWind } from '../../zustand';
import { useFarben } from '../../farben';
import { fmt, fmt0, datum } from '../../lib/format';
import {
  statistik, herstellerFortschritt, QUARTETTE, quartettStand, ABZEICHEN, dynamischeAbzeichen,
  perioden, fundTitel, istAbgebaut, SAMMEL_RADIUS,
} from '../../lib/spiel';
import { Karte, Knopf, Chips, Abschnitt, Leise, Etikett, Fortschritt, Blatt } from '../../ui';

export default function Heft() {
  const w = useWind();
  const c = useFarben();
  const { D, heft } = w;
  const s = useMemo(() => (heft ? statistik(D, heft) : null), [D, heft]);
  const [blatt, setBlatt] = useState(null);   // { titel, inhalt }

  if (!s || !D) return <View style={st.mitte}><Leise>Lade …</Leise></View>;

  return (
    <ScrollView contentContainerStyle={st.inhalt}>
      <Zahlen werte={[[s.funde.length, 'Anlagen'], [s.marken.size, 'Hersteller'], [s.modelle.size, 'Modelle'], [fmt.format(s.kw / 1000), 'MW']]} />
      <Abgebaut s={s} />

      <Abschnitt>Abzeichen</Abschnitt>
      <Abzeichen s={s} oeffne={setBlatt} />
      <Leise klein>Tippe auf ein Abzeichen, um zu sehen, welche Anlagen dafür gezählt haben.</Leise>

      <Abschnitt>Verlauf</Abschnitt>
      <Verlauf s={s} />

      <Abschnitt>Hersteller komplett</Abschnitt>
      <Leise klein style={{ marginBottom: 8 }}>Aktive Modelle = mindestens 10 Anlagen an Land in Betrieb. Antippen zeigt, welche dir noch fehlen.</Leise>
      <Hersteller s={s} />

      <Abschnitt>Quartette</Abschnitt>
      <Quartette s={s} oeffne={setBlatt} />

      <Abschnitt>Meine Funde</Abschnitt>
      <Funde s={s} />

      <Abschnitt>Sicherung</Abschnitt>
      <Sicherung />

      <Leise klein style={{ marginTop: 24 }}>Daten: {D.meta.quelle}, Stand {datum(D.meta.datenstand)}.</Leise>
      {__DEV__ && (
        <View style={st.testZeile}>
          <Switch value={w.test} onValueChange={w.setTest} trackColor={{ true: c.akzent }} />
          <Leise klein>Testmodus (nur Entwicklung): feste Position, Sammeln ohne Grenze</Leise>
        </View>
      )}

      <Blatt titel={blatt ? blatt.titel : ''} sichtbar={!!blatt} onZu={() => setBlatt(null)}>{blatt && blatt.inhalt}</Blatt>
    </ScrollView>
  );
}

function Zahlen({ werte }) {
  const c = useFarben();
  return (
    <View style={st.zahlen}>
      {werte.map(([z, t]) => (
        <View key={t} style={[st.zahl, { backgroundColor: c.flaeche, borderColor: c.linie }]}>
          <Text style={[st.zahlWert, { color: c.text }]}>{z}</Text>
          <Leise klein>{t}</Leise>
        </View>
      ))}
    </View>
  );
}

/* Abgebaute Anlagen – Erinnerungsstücke */
function Abgebaut({ s }) {
  const c = useFarben();
  const { D } = useWind();
  if (!s.abgebaut.length) return null;
  const n = s.abgebaut.length;
  return (
    <Karte style={{ marginTop: 12, backgroundColor: c.abgebautHell, borderColor: c.abgebaut }}>
      <Text style={{ fontWeight: '700', color: c.text, fontSize: 16 }}>🪦 {n === 1 ? 'Eine deiner Anlagen ist' : n + ' deiner Anlagen sind'} inzwischen abgebaut</Text>
      <Leise klein style={{ marginVertical: 6 }}>Du hast sie noch gesehen, bevor sie verschwunden ist – ein echtes Erinnerungsstück.</Leise>
      {s.abgebaut.map((f) => (
        <View key={f.id} style={{ paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.linie }}>
          <Text style={{ fontWeight: '700', color: c.text }}>{fundTitel(f)}</Text>
          <Leise klein>{[f.ort, 'gesammelt ' + datum(f.t), D.abgebaut[f.id] ? 'abgebaut ' + datum(D.abgebaut[f.id]) : null].filter(Boolean).join(' · ')}</Leise>
        </View>
      ))}
    </Karte>
  );
}

function Abzeichen({ s, oeffne }) {
  const c = useFarben();
  const { D, heft } = useWind();
  const alle = [...ABZEICHEN, ...dynamischeAbzeichen(D, s).filter((a) => heft.abzeichen[a.k])];
  const zeige = (a) => {
    const hat = heft.abzeichen[a.k];
    const belege = a.test(s) && a.belege ? a.belege(s) : [];
    oeffne({
      titel: a.ico + ' ' + a.name,
      inhalt: (
        <View>
          <Text style={{ color: c.text, fontSize: 16 }}>{a.text}</Text>
          <Leise klein style={{ marginTop: 4 }}>{hat ? 'Erhalten am ' + datum(hat) : 'Noch nicht erreicht'}</Leise>
          {belege.length > 0 && <Abschnitt>Dafür gezählt</Abschnitt>}
          {belege.slice(0, 40).map((b, i) => <Text key={i} style={{ color: c.text, paddingVertical: 3 }}>• {b}</Text>)}
          {belege.length > 40 && <Leise>… und {belege.length - 40} weitere</Leise>}
        </View>
      ),
    });
  };
  return (
    <View style={st.raster}>
      {alle.map((a) => {
        const hat = heft.abzeichen[a.k];
        return (
          <Pressable key={a.k} onPress={() => zeige(a)} accessibilityRole="button" accessibilityLabel={a.name + (hat ? ', erhalten' : ', offen')}
            style={[st.abz, { backgroundColor: c.flaeche, borderColor: c.linie }, !hat && { opacity: 0.45 }]}>
            <Text style={st.abzIco}>{a.ico}</Text>
            <Text style={[st.abzName, { color: c.text }]} numberOfLines={2}>{a.name}</Text>
            <Leise klein style={{ fontSize: 11, textAlign: 'center' }}>{hat ? datum(hat) : a.text}</Leise>
          </Pressable>
        );
      })}
    </View>
  );
}

/* Verlauf: Balken je Monat oder Jahr, darunter die Auswertung des gewählten Zeitraums */
function Verlauf({ s }) {
  const c = useFarben();
  const [art, setArt] = useState('monat');
  const [groesse, setGroesse] = useState('anlagen');
  const [wahl, setWahl] = useState(null);
  const liste = perioden(s, art);
  const wert = (p) => (groesse === 'kw' ? p.kw / 1000 : p[groesse]);
  const max = Math.max(...liste.map(wert), 0);
  const sel = liste.find((p) => p.key === wahl) || liste[liste.length - 1];
  const einheit = { anlagen: 'Anlagen', modelle: 'neue Modelle', kw: 'MW' }[groesse];
  return (
    <Karte>
      <View style={{ gap: 8 }}>
        <Chips werte={[['monat', 'Monate'], ['jahr', 'Jahre']]} wert={art} onWahl={(k) => { setArt(k); setWahl(null); }} />
        <Chips werte={[['anlagen', 'Anlagen'], ['modelle', 'Modelle'], ['kw', 'MW']]} wert={groesse} onWahl={setGroesse} />
      </View>
      <Leise klein style={{ marginTop: 10, minHeight: 18 }}>{max ? fmt.format(max) + ' ' + einheit : ''}</Leise>
      <View style={[st.balkenFlaeche, { borderBottomColor: c.linie }]}>
        {liste.map((p) => {
          const v = wert(p);
          const h = max ? Math.max(v ? 3 : 0, Math.round((100 * v) / max)) : 0;
          const an = p.key === sel.key;
          return (
            <Pressable key={p.key} onPress={() => setWahl(p.key)} style={st.saeulePlatz}
              accessibilityRole="button" accessibilityLabel={p.lang + ': ' + fmt.format(v) + ' ' + einheit}>
              <View style={[st.saeule, an && { backgroundColor: c.akzentHell }]}>
                <View style={{ height: h + '%', backgroundColor: c.akzent, opacity: an ? 1 : 0.55, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
              </View>
              <Text style={{ fontSize: 10, textAlign: 'center', color: an ? c.text : c.leise, fontWeight: an ? '700' : '400' }} numberOfLines={1}>{p.kurz}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ fontWeight: '700', color: c.text, marginTop: 14, marginBottom: 6 }}>{sel.lang}</Text>
      <Zahlen werte={[[sel.anlagen, 'Anlagen'], [sel.modelle, 'neue Modelle'], [fmt.format(sel.kw / 1000), 'MW'], [sel.beruehrt, 'berührt']]} />
    </Karte>
  );
}

/* Hersteller: Fortschritt über die aktiven Modelle, aufklappbar */
function Hersteller({ s }) {
  const c = useFarben();
  const { D } = useWind();
  const [offen, setOffen] = useState(null);
  const liste = herstellerFortschritt(D, s)
    .filter((h) => s.marken.has(h.marke))
    .sort((a, b) => b.gesammelt.length / b.modelle.length - a.gesammelt.length / a.modelle.length || b.modelle.length - a.modelle.length);
  const fehlend = [...D.markeAnzahl.entries()]
    .filter(([h]) => h != null && !s.marken.has(D.hersteller[h]))
    .sort((a, b) => b[1] - a[1]).slice(0, 16).map(([h]) => D.hersteller[h]);
  return (
    <View>
      {!s.funde.length && <Karte><Leise>Noch nichts gesammelt.</Leise></Karte>}
      {liste.map((h) => {
        const auf = offen === h.marke;
        const hat = s.marken.get(h.marke);
        const sonst = [...hat.keys()].filter((m) => !h.modelle.some((x) => x.modell === m));
        return (
          <Pressable key={h.marke} onPress={() => setOffen(auf ? null : h.marke)} accessibilityRole="button" accessibilityState={{ expanded: auf }}>
            <Karte style={{ padding: 14, marginBottom: 8 }}>
              <View style={st.markeKopf}>
                <Text style={{ fontWeight: '700', color: c.text, fontSize: 16 }}>{h.komplett ? '🏁 ' : ''}{h.marke} {auf ? '⌄' : '›'}</Text>
                <Leise klein>{h.gesammelt.length} von {h.modelle.length} aktiven Modellen</Leise>
              </View>
              <Fortschritt wert={h.gesammelt.length} gesamt={h.modelle.length} />
              {auf && (
                <View style={st.etiketten}>
                  {h.modelle.map((m) => {
                    const n = hat.get(m.modell);
                    return <Etikett key={m.modell} art={n ? 'gesammelt' : 'offen'} text={(n ? '✓ ' : '') + m.modell + (n > 1 ? ' ×' + n : '')} />;
                  })}
                </View>
              )}
              {auf && sonst.length > 0 && <Leise klein style={{ marginTop: 8 }}>Außerdem gesammelt: {sonst.join(', ')}</Leise>}
            </Karte>
          </Pressable>
        );
      })}
      {/* Marken ohne Liste aktiver Modelle (sehr kleine Hersteller) */}
      {[...s.marken].filter(([m]) => !D.aktivProMarke.has(m)).map(([m, mod]) => (
        <Karte key={m} style={{ padding: 14, marginBottom: 8 }}>
          <Text style={{ fontWeight: '700', color: c.text }}>{m}</Text>
          <View style={st.etiketten}>{[...mod].map(([x, n]) => <Etikett key={x} art="gesammelt" text={'✓ ' + x + (n > 1 ? ' ×' + n : '')} />)}</View>
        </Karte>
      ))}
      {fehlend.length > 0 && (
        <>
          <Leise klein style={{ marginTop: 4, marginBottom: 6 }}>Noch nicht gefunden:</Leise>
          <View style={st.etiketten}>{fehlend.map((m) => <Etikett key={m} art="offen" text={m} />)}</View>
        </>
      )}
    </View>
  );
}

/* Quartette mit Karten im Blatt */
function Quartette({ s, oeffne }) {
  const c = useFarben();
  const { D } = useWind();
  let gruppe = null;
  const zeige = (q, st_) => oeffne({
    titel: q.ico + ' ' + q.name,
    inhalt: (
      <View>
        <Leise>{q.text} · {st_.gesammelt} von {st_.karten.length} gesammelt</Leise>
        <View style={st.qkarten}>{st_.karten.map((m) => <QuartettKarte key={m.k} m={m} hat={st_.hat(m)} />)}</View>
        <Leise klein>Typische Werte (Median) der Anlagen an Land in Betrieb, Nabenhöhe mit Spanne (Marktstammdatenregister). Plattform-Zuordnung ohne Gewähr.</Leise>
      </View>
    ),
  });
  return (
    <View style={{ gap: 8 }}>
      {QUARTETTE.map((q) => {
        const stand = quartettStand(D, q, s);
        if (stand.karten.length < 2) return null;
        const kopf = q.gruppe !== gruppe ? (gruppe = q.gruppe) : null;
        const fertig = stand.gesammelt === stand.karten.length;
        return (
          <View key={q.k}>
            {kopf && <Text style={{ color: c.text, fontWeight: '700', marginTop: 8, marginBottom: 6, marginLeft: 4 }}>{kopf}</Text>}
            <Pressable onPress={() => zeige(q, stand)} accessibilityRole="button"
              style={[st.quartett, { backgroundColor: c.flaeche, borderColor: fertig ? c.gold : c.linie }]}>
              <Text style={{ fontSize: 26 }}>{q.ico}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: c.text }}>{q.name}</Text>
                <Leise klein>{q.text}</Leise>
                <Fortschritt wert={stand.gesammelt} gesamt={stand.karten.length} />
              </View>
              <Text style={{ fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>{stand.gesammelt}/{stand.karten.length}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function QuartettKarte({ m, hat }) {
  const c = useFarben();
  const werte = [
    ['Leistung', m.kw ? fmt.format(m.kw / 1000) + ' MW' : '–'],
    ['Rotor', m.rotor ? fmt0.format(m.rotor) + ' m' : '–'],
    ['Nabe', m.nabe ? fmt0.format(m.nabe) + ' m' : '–'],
    ['Spanne', m.nabeMax > m.nabeMin ? fmt0.format(m.nabeMin) + '–' + fmt0.format(m.nabeMax) : '–'],
    ['Bestand', fmt0.format(m.n)],
    ['Seit', m.ibn ? m.ibn.slice(0, 4) : '–'],
  ];
  return (
    <View style={[st.qkarte, { borderColor: hat ? c.akzent : c.linie, backgroundColor: hat ? c.flaeche : c.bg, opacity: hat ? 1 : 0.6 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Leise klein style={{ fontSize: 11 }}>{m.marke}</Leise>
        <Text style={{ fontWeight: '700', color: hat ? c.akzent : c.leise }}>{hat ? '✓' : '?'}</Text>
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 4 }}>{m.modell}</Text>
      {werte.map(([k, v]) => (
        <View key={k} style={[st.qZeile, { borderTopColor: c.linie }]}>
          <Leise klein>{k}</Leise>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

/* Fundliste mit Filter */
function Funde({ s }) {
  const c = useFarben();
  const { D, waehle } = useWind();
  const router = useRouter();
  const [filter, setFilter] = useState('alle');
  const test = { alle: () => true, beruehrt: (f) => f.b, abgebaut: (f) => istAbgebaut(D, f.id) }[filter];
  const liste = s.funde.filter(test).sort((a, b) => b.t - a.t);
  const werte = [['alle', 'Alle ' + s.funde.length]];
  if (s.beruehrt.length) werte.push(['beruehrt', '🤚 Berührt ' + s.beruehrt.length]);
  if (s.abgebaut.length) werte.push(['abgebaut', '🪦 Abgebaut ' + s.abgebaut.length]);
  return (
    <View>
      <View style={{ marginBottom: 8 }}><Chips werte={werte} wert={filter} onWahl={setFilter} /></View>
      <View style={[st.liste, { backgroundColor: c.flaeche, borderColor: c.linie }]}>
        {!liste.length && (
          <Leise style={{ padding: 16, textAlign: 'center' }}>
            {filter === 'alle' ? 'Geh in die Nähe einer Anlage (unter ' + SAMMEL_RADIUS + ' m) und tippe auf „Sammeln“.' : 'Keine Funde in dieser Auswahl.'}
          </Leise>
        )}
        {liste.map((f, n) => {
          const weg = istAbgebaut(D, f.id);
          const i = D.idIndex.get(f.id);
          return (
            <Pressable key={f.id} onPress={() => { if (i != null) { waehle(i); router.navigate('/'); } }} disabled={i == null}
              style={[st.zeile, n > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.linie }, weg && { backgroundColor: c.abgebautHell }]}>
              <Text style={{ width: 26, textAlign: 'center', fontSize: 18, color: c.akzent }}>{weg ? '🪦' : f.b ? '🤚' : '★'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', color: c.text, fontSize: 16 }} numberOfLines={1}>{fundTitel(f)}</Text>
                <Leise klein>{[weg ? 'abgebaut' + (D.abgebaut[f.id] ? ' ' + datum(D.abgebaut[f.id]) : '') : null, f.ort, f.kreis].filter(Boolean).join(' · ')}</Leise>
              </View>
              <Text style={{ fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>{datum(f.t)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* Sicherung: Export als Datei, Import (auch aus der Web-App) */
function Sicherung() {
  const w = useWind();
  const exportiere = async () => {
    try {
      const f = new File(Paths.cache, 'windsammler-' + new Date().toISOString().slice(0, 10) + '.json');
      if (f.exists) f.delete();
      f.create();
      await f.write(JSON.stringify(w.heft, null, 1));
      await Sharing.shareAsync(f.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Sammelheft sichern' });
    } catch (e) {
      w.zeige('Export fehlgeschlagen: ' + (e.message || e));
    }
  };
  const importiere = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true });
      if (r.canceled) return;
      const n = w.importiere(JSON.parse(await new File(r.assets[0].uri).text()));
      w.zeige(n + ' Funde importiert');
    } catch (_) {
      w.zeige('Datei ist kein Windsammler-Export');
    }
  };
  return (
    <Karte>
      <Leise>Dein Sammelheft liegt nur auf diesem Gerät. Exportiere es ab und zu als Datei. Ein Export aus der Web-App lässt sich hier importieren.</Leise>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Knopf titel="Exportieren" onPress={exportiere} />
        <Knopf titel="Importieren" onPress={importiere} />
      </View>
    </Karte>
  );
}

const st = StyleSheet.create({
  inhalt: { padding: 16, paddingBottom: 40 },
  mitte: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  zahlen: { flexDirection: 'row', gap: 8 },
  zahl: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  zahlWert: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  raster: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  abz: { width: '31.5%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center' },
  abzIco: { fontSize: 28 },
  abzName: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  balkenFlaeche: { flexDirection: 'row', height: 140, gap: 2, borderBottomWidth: 1, paddingBottom: 2 },
  saeulePlatz: { flex: 1 },
  saeule: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 2, borderRadius: 6 },
  markeKopf: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  etiketten: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  quartett: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 12 },
  qkarten: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
  qkarte: { width: '48.5%', borderWidth: 1, borderRadius: 12, padding: 10 },
  qZeile: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, borderTopWidth: StyleSheet.hairlineWidth },
  liste: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  zeile: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  testZeile: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
});
