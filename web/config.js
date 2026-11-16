// Supabase-Zugang für Rangliste und Gruppen.
// Der "anon"/"publishable" Key ist öffentlich und darf hier stehen – geschützt wird über die
// Zugriffsregeln in supabase/schema.sql. Den service_role-Key NIEMALS hier eintragen.
// Leer lassen = App läuft rein lokal ohne Rangliste.
window.WINDSAMMLER_CONFIG = {
  supabaseUrl: 'https://slgxtcpasnewiajiqlff.supabase.co',
  supabaseKey: 'sb_publishable_hNoVO3n1yuGuKvl68bB6RQ_-A3LU2RR',
  // Cloudflare-Turnstile "Site Key" (öffentlich). Den zugehörigen Secret Key nur im
  // Supabase-Dashboard eintragen (Authentication → Attack Protection → Captcha).
  turnstileSiteKey: '0x4AAAAAAGDWgqbqQFTzPaZr',
};
