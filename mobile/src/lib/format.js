// Zahlen, Datumsangaben und Entfernungen im deutschen Format

export const fmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
export const fmt0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export function datum(x) {
  if (!x) return '';
  const d = typeof x === 'number' ? new Date(x) : new Date(x.length === 10 ? x + 'T00:00:00' : x);
  const zwei = (n) => String(n).padStart(2, '0');
  return zwei(d.getDate()) + '.' + zwei(d.getMonth() + 1) + '.' + d.getFullYear();
}

export function entfernung(m) {
  if (m < 1000) return fmt0.format(Math.round(m / 10) * 10) + ' m';
  return fmt.format(m / 1000) + ' km';
}

export const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const MONATE_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
