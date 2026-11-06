// Cache hors-ligne du shell (utile en PWA ; l'APK embarque déjà ces fichiers).
const C = 'trotti-shell-3';
const FILES = ['./', 'index.html', 'boot.js', 'app.js', 'style.css', 'icon.svg', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(C).then(c => c.addAll(FILES))); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
