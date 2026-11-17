// Entfernung und Richtung auf der Kugel

const RAD = Math.PI / 180;

export function distanz(la1, lo1, la2, lo2) {
  const dLa = (la2 - la1) * RAD, dLo = (lo2 - lo1) * RAD;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(dLo / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(a));
}

export function peilung(la1, lo1, la2, lo2) {
  const y = Math.sin((lo2 - lo1) * RAD) * Math.cos(la2 * RAD);
  const x = Math.cos(la1 * RAD) * Math.sin(la2 * RAD) - Math.sin(la1 * RAD) * Math.cos(la2 * RAD) * Math.cos((lo2 - lo1) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export const RICHTUNGEN = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
export const KURZ = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
export const PFEILE = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
export const sektor = (grad) => Math.round(grad / 45) % 8;

// Alle Anlagen im Umkreis, sortiert nach Entfernung, plus die nächste überhaupt
export function berechneNah(D, pos, radius, mitPlanung) {
  const { lat, lon } = pos;
  const dLat = radius / 111320;
  const nah = [];
  let best = null, bestD = Infinity;
  const st = D.F.status;
  for (let i = 0; i < D.n; i++) {
    if (!mitPlanung && D.rows[i][st] === D.planungIdx) continue;
    const grob = Math.abs(D.lat[i] - lat);
    if (grob > dLat && grob * 111320 > bestD) continue;
    const d = distanz(lat, lon, D.lat[i], D.lon[i]);
    if (d < bestD) { bestD = d; best = i; }
    if (d <= radius) nah.push({ i, d });
  }
  nah.sort((a, b) => a.d - b.d);
  return { nah, naechste: best };
}
