"""Erzeugt aus dem MaStR-Gesamtdatenexport die Datendatei der Wind-App.

Eingabe:  pipeline/rohdaten/EinheitenWind.xml, Katalogwerte.xml
Ausgabe:  web/data/wind.json  (kompakt: Feldliste + Zeilen als Arrays)

Aufruf:   python pipeline/build_wind.py [--rohdaten PFAD] [--ausgabe PFAD]
"""
from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import date
from pathlib import Path

BASIS = Path(__file__).resolve().parent

# Felder der Ausgabe, Reihenfolge = Spaltenreihenfolge im JSON
FELDER = [
    "id",          # EinheitMastrNummer
    "lat", "lon",
    "name",        # NameStromerzeugungseinheit
    "park",        # NameWindpark
    "hersteller",  # Index in "hersteller"-Liste (vereinheitlichte Marke)
    "typ",         # Typenbezeichnung wie gemeldet
    "modell",      # Modellfamilie zum Sammeln, z.B. "E-82", "V112"
    "kw",          # Bruttoleistung in kW
    "nabe",        # Nabenhöhe in m
    "rotor",       # Rotordurchmesser in m
    "ibn",         # Inbetriebnahmedatum (JJJJ-MM-TT)
    "status",      # Index in "status"-Liste
    "ort",
    "kreis",       # Landkreis
    "land",        # Index in "bundesland"-Liste
    "see",         # 1 = auf See (offshore)
]

# Endgültig stillgelegte Anlagen stehen nicht mehr in der Landschaft
STATUS_AUSSCHLIESSEN = {"Endgültig stillgelegt"}


# Firmen-Varianten derselben Marke (Präfix des MaStR-Herstellernamens -> Marke).
# Historische Marken (Tacke, NEG Micon, REpower, ...) bleiben bewusst eigenständig.
MARKEN = [
    ("ENERCON", "Enercon"),
    ("MHI Vestas", "MHI Vestas"),
    ("Vestas", "Vestas"),
    ("Nordex", "Nordex"),
    ("Siemens", "Siemens Gamesa"),
    ("Gamesa", "Gamesa"),
    ("GE ", "GE"),
    ("General Electric", "GE"),
    ("AN Bonus", "AN Windenergie"),
    ("AN-Maschinenbau", "AN Windenergie"),
    ("AN Wind", "AN Windenergie"),
    ("eno energy", "eno energy"),
    ("Pfleiderer", "Pfleiderer"),
    ("Ventis", "Ventis"),
    ("VENTIS", "Ventis"),
    ("HSW Husumer", "HSW Husum"),
    ("Husumer", "HSW Husum"),
    ("Zentrum für Sonnenenergie", "ZSW"),
]
RECHTSFORMEN = re.compile(
    r"\s*(GmbH & Co\. KGaA|GmbH & Co\. KG|GmbH|AG|SE|A/S|S\.A\.|S\.L|Aktiengesellschaft|Holding|Deutschland)\b\.?",
)


def marke(hersteller: str | None) -> str | None:
    if not hersteller or hersteller == "Sonstige":
        return None
    for praefix, name in MARKEN:
        if hersteller.startswith(praefix):
            return name
    return RECHTSFORMEN.sub("", hersteller).strip(" ,") or hersteller


MODELL = re.compile(r"([A-Z]{1,4})[\s\-]?(\d+(?:[.,]\d+)?)")


def modell(typ: str | None, marke_: str | None) -> str | None:
    """Modellfamilie aus der frei erfassten Typenbezeichnung ("Enercon E 82 E2" -> "E-82")."""
    if not typ:
        return None
    text = typ.upper()
    if marke_:
        text = text.replace(marke_.upper(), " ")
    treffer = MODELL.search(text)
    if not treffer:
        return text.strip()[:20] or None
    buchstaben, nummer = treffer.group(1), treffer.group(2).replace(",", ".")
    # Enercon schreibt seine Typen mit Bindestrich (E-82), die übrigen ohne (V112, N117, MM92)
    return f"{buchstaben}-{nummer}" if buchstaben == "E" else f"{buchstaben}{nummer}"


def datensaetze(pfad: Path):
    """Streamt die flachen MaStR-Datensätze als dicts (konstanter Speicherbedarf)."""
    ereignisse = ET.iterparse(pfad, events=("start", "end"))
    _, wurzel = next(ereignisse)
    for ereignis, element in ereignisse:
        if ereignis == "end" and len(element):
            yield {feld.tag: feld.text for feld in element}
            wurzel.clear()


def zahl(text: str | None, nachkomma: int = 1):
    if not text:
        return None
    try:
        wert = round(float(text), nachkomma)
    except ValueError:
        return None
    return int(wert) if wert == int(wert) else wert


class Index:
    """Ordnet Texten eine laufende Nummer zu, damit sie nur einmal im JSON stehen."""

    def __init__(self):
        self.werte: list[str] = []
        self._pos: dict[str, int] = {}

    def __call__(self, wert: str | None):
        if not wert:
            return None
        if wert not in self._pos:
            self._pos[wert] = len(self.werte)
            self.werte.append(wert)
        return self._pos[wert]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--rohdaten", type=Path, default=BASIS / "rohdaten")
    ap.add_argument("--ausgabe", type=Path, default=BASIS.parent / "web" / "data" / "wind.json")
    args = ap.parse_args()

    katalog = {d["Id"]: d["Wert"] for d in datensaetze(args.rohdaten / "Katalogwerte.xml")}

    hersteller, status, bundesland = Index(), Index(), Index()
    zeilen = []
    zaehler = Counter()
    stand = ""

    for d in datensaetze(args.rohdaten / "EinheitenWind.xml"):
        zaehler["gesamt"] += 1
        stand = max(stand, (d.get("DatumLetzteAktualisierung") or "")[:10])
        st = katalog.get(d.get("EinheitBetriebsstatus"), "unbekannt")
        if st in STATUS_AUSSCHLIESSEN:
            zaehler["stillgelegt"] += 1
            continue
        lat, lon = zahl(d.get("Breitengrad"), 6), zahl(d.get("Laengengrad"), 6)
        if lat is None or lon is None:
            zaehler["ohne Koordinaten"] += 1
            continue
        see = katalog.get(d.get("WindAnLandOderAufSee"), "") == "Windkraft auf See"
        mk = marke(katalog.get(d.get("Hersteller")))
        typ = (d.get("Typenbezeichnung") or "").strip() or None
        zeilen.append([
            d["EinheitMastrNummer"],
            lat, lon,
            d.get("NameStromerzeugungseinheit"),
            d.get("NameWindpark"),
            hersteller(mk),
            typ,
            modell(typ, mk),
            zahl(d.get("Bruttoleistung")),
            zahl(d.get("Nabenhoehe")),
            zahl(d.get("Rotordurchmesser")),
            d.get("Inbetriebnahmedatum"),
            status(st),
            d.get("Ort"),
            d.get("Landkreis"),
            bundesland(katalog.get(d.get("Bundesland"))),
            1 if see else 0,
        ])
        zaehler["übernommen"] += 1

    ausgabe = {
        "meta": {
            "quelle": "Marktstammdatenregister (Bundesnetzagentur), Datenlizenz Deutschland – Namensnennung – 2.0",
            "datenstand": stand,
            "erzeugt": date.today().isoformat(),
            "anzahl": len(zeilen),
        },
        "felder": FELDER,
        "hersteller": hersteller.werte,
        "status": status.werte,
        "bundesland": bundesland.werte,
        "anlagen": zeilen,
    }
    args.ausgabe.parent.mkdir(parents=True, exist_ok=True)
    with open(args.ausgabe, "w", encoding="utf-8") as f:
        json.dump(ausgabe, f, ensure_ascii=False, separators=(",", ":"))

    groesse = args.ausgabe.stat().st_size / 1e6
    print(f"{args.ausgabe}  ({groesse:.1f} MB)")
    for k, v in zaehler.items():
        print(f"  {k:>18}: {v:>7}")
    i = {f: n for n, f in enumerate(FELDER)}
    print("  Status:", dict(Counter(status.werte[z[i["status"]]] for z in zeilen)))
    print(f"  Marken: {len(hersteller.werte)}",
          Counter(hersteller.werte[z[i["hersteller"]]] for z in zeilen if z[i["hersteller"]] is not None).most_common(8))
    modelle = Counter((z[i["hersteller"]], z[i["modell"]]) for z in zeilen if z[i["modell"]])
    print(f"  Modellfamilien: {len(modelle)}",
          [(hersteller.werte[h] if h is not None else "?", m, n) for (h, m), n in modelle.most_common(12)])


if __name__ == "__main__":
    main()
