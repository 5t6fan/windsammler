// Supabase-Zugang für Rangliste und Gruppen.
// Der "anon"/"publishable" Key ist öffentlich und darf hier stehen – geschützt wird über die
// Zugriffsregeln in supabase/schema.sql. Den service_role-Key NIEMALS hier eintragen.
// Leer lassen = App läuft rein lokal ohne Rangliste.
window.WINDSAMMLER_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
