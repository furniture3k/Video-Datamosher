// moshpit's editor used to live at the site's root, with its offline service worker here. It moved
// to app/ (with its own service worker), so this one only removes itself and the old caches when a
// browser that had it installed comes back, then reloads the pages it was looking after.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (/^moshpit-\d+-/.test(k) || k === 'moshpit-fonts') await caches.delete(k);
      await self.registration.unregister();
      for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
    })(),
  );
});
