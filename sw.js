/* Service worker ViceClip v2 : app installable + utilisable hors ligne.
   Stratégie « réseau d'abord » : chaque mise à jour publiée est récupérée dès qu'il y a du réseau. */
const CACHE = 'viceclip-v2.0.0';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'render.js', 'analysis.js', 'sources.js', 'ai.js',
  'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html')))
  );
});
