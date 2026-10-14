// Service worker for the installable web app: keeps every file of the build (including the
// ~30 MB video engine) on the device so the app opens and works offline.
// The build (vite.config.ts) prepends VERSION and FILES.
/* global VERSION, FILES */
const CACHE = 'moshpit-' + VERSION;
const FONTS = 'moshpit-fonts';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  // keep the previous version too, so a tab still running it can finish loading its files
  e.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const ours = keys.filter((k) => /^moshpit-\d+-/.test(k) && k !== CACHE).sort((a, b) => parseInt(a.slice(8)) - parseInt(b.slice(8)));
        return Promise.all(ours.slice(0, -1).map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req)
            .then((r) => (r.ok && c.put(req, r.clone()), r))
            .catch(() => hit);
          return hit || net;
        }),
      ),
    );
    return;
  }
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // the page itself: fresh when online, cached when not
    e.respondWith(fetch(req).catch(() => caches.match('./index.html', { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
