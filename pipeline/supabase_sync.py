"""Spielt supabase/schema.sql ein und lädt die Windanlagen aus web/data/wind.json in Supabase.

Die Verbindung kommt aus pipeline/.env (nicht im Git):
    DATABASE_URL=postgresql://postgres.<projekt>:<passwort>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
(Supabase → Connect → "Session pooler")

Aufruf:   python pipeline/supabase_sync.py            Schema + Anlagen
          python pipeline/supabase_sync.py --schema   nur Schema
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import psycopg

BASIS = Path(__file__).resolve().parent
PROJEKT = BASIS.parent
SELTEN_MAX = 20  # Modelle mit höchstens so vielen Anlagen (ohne geplante) gelten als selten


def lade_env():
    datei = BASIS / ".env"
    if datei.exists():
        for zeile in datei.read_text(encoding="utf-8").splitlines():
            if "=" in zeile and not zeile.lstrip().startswith("#"):
                k, v = zeile.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL fehlt – bitte in pipeline/.env eintragen (siehe Kopf dieser Datei).")
    return url


def anlagen_zeilen():
    d = json.loads((PROJEKT / "web" / "data" / "wind.json").read_text(encoding="utf-8"))
    f = {name: i for i, name in enumerate(d["felder"])}
    planung = d["status"].index("In Planung") if "In Planung" in d["status"] else -1
    for z in d["anlagen"]:
        h = z[f["hersteller"]]
        yield (
            z[f["id"]], z[f["lat"]], z[f["lon"]],
            d["hersteller"][h] if h is not None else None,
            z[f["modell"]], z[f["kw"]], z[f["nabe"]], z[f["ibn"]],
            z[f["status"]] == planung,
        )


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--schema", action="store_true", help="nur das Schema einspielen")
    args = ap.parse_args()

    with psycopg.connect(lade_env(), autocommit=False) as con, con.cursor() as cur:
        cur.execute((PROJEKT / "supabase" / "schema.sql").read_text(encoding="utf-8"))
        print("Schema eingespielt.")
        if args.schema:
            con.commit()
            return

        cur.execute("create temp table neu (like public.anlagen including defaults) on commit drop")
        with cur.copy("copy neu (id, lat, lon, marke, modell, kw, nabe, ibn, planung) from stdin") as cp:
            n = 0
            for zeile in anlagen_zeilen():
                cp.write_row(zeile)
                n += 1
        # Seltenheit je Modell bestimmen
        cur.execute("""
            update neu set selten = true
              from (select marke, modell from neu
                     where not planung and modell is not null
                     group by marke, modell having count(*) <= %s) s
             where neu.marke is not distinct from s.marke and neu.modell = s.modell
        """, (SELTEN_MAX,))
        # Unikate: Modelle, die es nur einmal gibt
        cur.execute("""
            update neu set unikat = true
              from (select marke, modell from neu
                     where not planung and modell is not null
                     group by marke, modell having count(*) = 1) s
             where neu.marke is not distinct from s.marke and neu.modell = s.modell
        """)
        # Einfügen/aktualisieren; verschwundene Anlagen bleiben stehen, damit alte Funde gültig bleiben
        cur.execute("""
            insert into public.anlagen select * from neu
            on conflict (id) do update set
              lat = excluded.lat, lon = excluded.lon, marke = excluded.marke, modell = excluded.modell,
              kw = excluded.kw, nabe = excluded.nabe, ibn = excluded.ibn,
              planung = excluded.planung, selten = excluded.selten, unikat = excluded.unikat
        """)
        con.commit()
        cur.execute("select count(*), count(*) filter (where selten), count(*) filter (where unikat), count(*) filter (where planung) from public.anlagen")
        gesamt, selten, unikat, planung = cur.fetchone()
        print(f"{n} Anlagen übertragen. In der Datenbank: {gesamt} (davon {selten} selten, {unikat} Unikate, {planung} in Planung).")


if __name__ == "__main__":
    main()
