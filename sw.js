// Network-first cache so the game still opens offline once it has been played,
// while updates show up as soon as there is a connection.
const CACHE = 'pocket-links-v19';
const ASSETS = [
  './',
  'index.html',
  'styles.css?v=19',
  'manifest.webmanifest',
  'src/game.js?v=19',
  'src/course.js?v=19',
  'src/sim.js?v=19',
  'src/render.js?v=19',
  'src/net.js?v=19',
  'src/audio.js?v=19',
  'src/view3d.js?v=19',
  'src/flora.js?v=19',
  'src/props.js?v=19',
  'src/vendor/three.bundle.min.js?v=19',
  'src/vendor/mqtt.min.js',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const same = new URL(e.request.url).origin === location.origin;
  e.respondWith(
    // Always check with the server (no stale HTTP cache), fall back offline.
    // (Fetching by URL works for page loads too; a Request can't take options then.)
    (same ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request))
      .then((res) => {
        if (res.ok && same) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match(e.request, { ignoreSearch: true }))),
  );
});
