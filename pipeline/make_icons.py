"""Erzeugt die PNG-App-Icons (180/192/512 px) ohne Zusatzpakete – Motiv wie web/icons/icon.svg."""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ZIEL = Path(__file__).resolve().parent.parent / "web" / "icons"
OBEN, UNTEN = (0x2A, 0xA5, 0x85), (0x0B, 0x55, 0x46)
SS = 3  # Supersampling je Achse


def im_rundrechteck(x, y, r=112):
    dx = max(r - x, 0, x - (512 - r))
    dy = max(r - y, 0, y - (512 - r))
    return dx * dx + dy * dy <= r * r


def ist_weiss(x, y):
    # Turm (Trapez)
    if 210 <= y <= 450:
        t = (y - 210) / 240
        if abs(x - 256) <= 12 + 16 * t:
            return True
    # Nabe
    lx, ly = x - 256, y - 200
    if lx * lx + ly * ly <= 22 * 22:
        return True
    # Drei Rotorblätter: in Blatt-Koordinaten zurückdrehen
    for winkel in (0, 120, 240):
        a = math.radians(-winkel)
        bx = lx * math.cos(a) - ly * math.sin(a)
        by = lx * math.sin(a) + ly * math.cos(a)
        if -165 <= by <= 0:
            t = -by / 165
            if abs(bx) <= 12 * (1 - t ** 1.6) + 0.5:
                return True
    return False


def render(groesse: int) -> bytes:
    skala = 512 / groesse
    zeilen = bytearray()
    for py in range(groesse):
        zeilen.append(0)
        for px in range(groesse):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) * skala
                    y = (py + (sy + 0.5) / SS) * skala
                    if not im_rundrechteck(x, y):
                        continue
                    if ist_weiss(x, y):
                        c = (255, 255, 255)
                    else:
                        t = y / 512
                        c = tuple(o + (u - o) * t for o, u in zip(OBEN, UNTEN))
                    r += c[0]; g += c[1]; b += c[2]; a += 1
            n = SS * SS
            if a:
                zeilen += bytes((round(r / a), round(g / a), round(b / a), round(255 * a / n)))
            else:
                zeilen += b"\0\0\0\0"
    return png(groesse, bytes(zeilen))


def png(groesse: int, roh: bytes) -> bytes:
    def chunk(typ, daten):
        return struct.pack(">I", len(daten)) + typ + daten + struct.pack(">I", zlib.crc32(typ + daten))
    kopf = struct.pack(">IIBBBBB", groesse, groesse, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", kopf) + chunk(b"IDAT", zlib.compress(roh, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    ZIEL.mkdir(parents=True, exist_ok=True)
    for g in (180, 192, 512):
        (ZIEL / f"icon-{g}.png").write_bytes(render(g))
        print(ZIEL / f"icon-{g}.png")
