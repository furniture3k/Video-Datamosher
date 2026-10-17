// Service worker for the installable web app: keeps every file of the build (including the
// ~30 MB video engine) on the device so the app opens and works offline.
// It lives in app/ (the editor), so it only looks after the editor's pages, not the website's.
// The build (vite.config.ts) prepends VERSION and FILES (relative to app/).
/* global VERSION, MT_VERSION, FILES */
const CACHE = 'moshpit-app-' + VERSION;
const FONTS = 'moshpit-app-fonts';
// the multithreaded video engine: not downloaded up front, kept once used (see below)
const LAZY = 'moshpit-app-lazy-' + MT_VERSION;

/**
 * The editor's pages are "cross-origin isolated", which lets the video engine use several threads
 * (SharedArrayBuffer). GitHub Pages can't send these headers, so the service worker adds them.
 * `credentialless` still lets the page load other sites' files (fonts, models) without changes;
 * browsers that don't know it simply stay single-threaded.
 */
function isolated(res) {
  if (!res || res.type === 'opaque' || res.type === 'opaqueredirect' || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

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
        const ours = keys.filter((k) => /^moshpit-app-\d+-/.test(k) && k !== CACHE).sort((a, b) => parseInt(a.slice(12)) - parseInt(b.slice(12)));
        const oldLazy = keys.filter((k) => k.startsWith('moshpit-app-lazy-') && k !== LAZY);
        return Promise.all([...ours.slice(0, -1), ...oldLazy].map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim()),
  );
});

// Files shared to the installed app from another app (share_target in the manifest) arrive as a
// form POST. They're parked in a cache and the app is opened with ?shared=1 to pick them up.
const SHARE = 'moshpit-share';
async function receiveShare(req) {
  const back = new URL('./?shared=1', self.registration.scope).href;
  try {
    const form = await req.formData();
    const cache = await caches.open(SHARE);
    for (const k of await cache.keys()) await cache.delete(k);
    let i = 0;
    for (const f of form.getAll('media')) {
      if (!(f instanceof File)) continue;
      const key = new URL(`./__shared/${i++}?name=${encodeURIComponent(f.name || 'shared')}`, self.registration.scope).href;
      await cache.put(key, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream' } }));
    }
  } catch (err) {
    console.warn('share target', err);
  }
  return Response.redirect(back, 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
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
    e.respondWith(
      fetch(req)
        .catch(() => caches.match('./index.html', { ignoreSearch: true }))
        .then(isolated),
    );
    return;
  }
  if (url.pathname.includes('/ffmpeg-mt/')) {
    e.respondWith(
      caches.open(LAZY).then((c) =>
        c.match(req, { ignoreSearch: true }).then(
          (hit) =>
            hit ||
            fetch(req).then((r) => {
              if (r.ok) c.put(req, r.clone());
              return r;
            }),
        ),
      ).then(isolated),
    );
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)).then(isolated));
});
