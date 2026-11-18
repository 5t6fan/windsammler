// Service Worker: App und Anlagendaten offline verfügbar halten.
// Bei Änderungen an App-Dateien VERSION erhöhen, damit iPhones die neue Fassung laden.
const VERSION = 'v9';
const APP = [
  './', 'index.html', 'datenschutz.html', 'nutzungsbedingungen.html', 'style.css', 'app.js', 'online.js', 'config.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png',
  'vendor/leaflet.css', 'vendor/leaflet.js', 'vendor/supabase.js',
];
const DATEN = 'data/wind.json';

self.addEventListener('install', (e) => {
  // cache: 'reload' umgeht den HTTP-Cache des Browsers (GitHub Pages: max-age=600),
  // sonst landet beim Versionswechsel womöglich noch die alte app.js im neuen Cache.
  const neu = [...APP, DATEN].map((u) => new Request(u, { cache: 'reload' }));
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(neu)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Nur eigene Dateien cachen; Kartenkacheln, Supabase und Turnstile immer direkt ans Netz
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.endsWith(DATEN)) {
    // Daten: sofort aus dem Cache, im Hintergrund aktualisieren
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const alt = await c.match(e.request);
      const neu = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => alt);
      return alt || neu;
    }));
    return;
  }
  // App-Dateien: Cache zuerst, sonst Netz
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
