// Gleiche Werte wie web/config.js. Der "publishable" Key ist öffentlich – geschützt wird über die
// Zugriffsregeln in supabase/schema.sql. Den service_role-Key NIEMALS hier eintragen.
export const SUPABASE_URL = 'https://slgxtcpasnewiajiqlff.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_hNoVO3n1yuGuKvl68bB6RQ_-A3LU2RR';

// Web-Seiten auf GitHub Pages
export const WEB = 'https://5t6fan.github.io/windsammler/';
export const CAPTCHA_URL = WEB + 'captcha.html';            // Cloudflare Turnstile, liefert den Token per postMessage
export const DATENSCHUTZ_URL = WEB + 'datenschutz.html';
export const BEDINGUNGEN_URL = WEB + 'nutzungsbedingungen.html';
