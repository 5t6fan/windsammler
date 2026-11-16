// Service Worker: App und Anlagendaten offline verfügbar halten.
// Bei Änderungen an App-Dateien VERSION erhöhen, damit iPhones die neue Fassung laden.
const VERSION = 'v1';
const APP = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];
const DATEN = 'data/wind.json';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll([...APP, DATEN])).then(() => self.skipWaiting()));
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
  if (e.request.method !== 'GET' || url.hostname.endsWith('openstreetmap.org')) return; // Kartenkacheln nicht cachen

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
