# Windsammler

Web-App (PWA) fürs iPhone: Windenergieanlagen in der Nähe finden und in einem Sammelheft sammeln.
Daten: Marktstammdatenregister (Bundesnetzagentur), Datenlizenz Deutschland – Namensnennung – 2.0.

## Aufbau

```
pipeline/build_wind.py   MaStR-XML -> web/data/wind.json (Windanlagen, Marken/Modelle vereinheitlicht)
                         + Liste kürzlich endgültig stillgelegter Anlagen ("abgebaut" im Sammelheft)
pipeline/make_icons.py   erzeugt die PNG-App-Icons
pipeline/rohdaten/       EinheitenWind.xml, Katalogwerte.xml aus dem Gesamtdatenexport (nicht im Git)
web/                     die App: index.html, app.js, style.css, sw.js (offline), manifest
```

## Rangliste (Supabase)

- `supabase/schema.sql` – Tabellen, Zugriffsregeln, Funktionen (sammeln mit 300-m- und Tempo-Prüfung, Gruppen, Rangliste)
- `pipeline/supabase_sync.py` – spielt das Schema ein und lädt die Anlagen hoch (`DATABASE_URL` in `pipeline/.env`)
- `web/config.js` – Projekt-URL und öffentlicher anon/publishable Key; leer = ohne Rangliste
- In Supabase: Authentication → Sign In / Providers → „Allow anonymous sign-ins“ einschalten

Nach jedem Daten-Update zusätzlich `python pipeline/supabase_sync.py` ausführen.

## Daten aktualisieren

1. Neuen Gesamtdatenexport laden, `EinheitenWind.xml` und `Katalogwerte.xml` nach `pipeline/rohdaten/` kopieren
2. `python pipeline/build_wind.py`
3. In `web/sw.js` die `VERSION` erhöhen, damit installierte Apps neu laden

## Lokal testen (Rechner)

```
python -m http.server 8765 -d web
```

- http://localhost:8765/?pos=51.2650,9.7300 – simulierter Standort
- http://localhost:8765/?pos=51.2650,9.7300&test – Sammeln ohne 300-m-Grenze

## Aufs iPhone (GitHub Pages)

Safari gibt Standort und Kompass nur über HTTPS frei, deshalb wird die App veröffentlicht:

1. Repository auf GitHub anlegen und pushen
2. Repository → Settings → Pages → Source: **GitHub Actions** (einmalig)
3. Der Workflow `.github/workflows/pages.yml` veröffentlicht `web/` bei jedem Push auf `main`
4. Auf dem iPhone die Pages-Adresse in Safari öffnen → Teilen → „Zum Home-Bildschirm“

## App für iPhone und Android (Expo, im Aufbau)

`mobile/` enthält eine native Fassung mit Expo (SDK 58, Expo Router). Sie nutzt dieselben Anlagendaten
(lädt `wind.json` von GitHub Pages und speichert sie auf dem Gerät) und später dieselbe Supabase.
Die Spiellogik liegt in `mobile/src/lib/` und entspricht der in `web/app.js`.

Stand Prototyp: In der Nähe (Kompass, Karte, Liste), Sammeln, Turm berühren, Sammelheft mit Abzeichen,
Verlauf, Hersteller komplett, Quartetten, Fundliste, Export/Import. Rangliste und Bewertungen folgen.

### Auf dem iPhone testen (ohne Mac)

1. Node.js (LTS) auf dem Rechner, auf dem iPhone die App **Expo Go** aus dem App Store
2. `cd mobile` · `npm install` · `npx expo start`
3. Den QR-Code mit der iPhone-Kamera scannen – die App öffnet sich in Expo Go
   - Rechner und iPhone müssen im selben WLAN sein; die Windows-Firewall-Abfrage für Node erlauben
   - Klappt das nicht (z. B. Firmen-WLAN): `npx expo start --tunnel`
4. Zum Testen am Schreibtisch: im Startbildschirm „Testmodus“ antippen (feste Position bei Kassel,
   Sammeln ohne Entfernungsgrenze; nur in der Entwicklung sichtbar)

Ein Sammelheft aus der Web-App lässt sich übernehmen: dort „Exportieren“, in der App „Importieren“.
