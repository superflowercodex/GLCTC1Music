/* GLCTC1 MUSIC — service worker
   Keeps the installed DAW working with no internet.
   Pages: network first (so updates arrive), cached copy when offline.
   Icons / scripts / styles: cache first, refreshed in the background. */
const CACHE = 'glctc1-daw-v1';
const CDN = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['daw.html', 'glctc1-icon-192.png']).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('glctc1-daw-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* the page sends its own URL + assets after the first load, so the page is cached even before a reload */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type !== 'glctc-cache' || !Array.isArray(d.urls)) return;
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(d.urls.map(u =>
    fetch(u, { cache: 'no-cache' }).then(r => { if (r.ok) return c.put(u, r) }).catch(() => {})
  ))));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && !CDN.some(c => req.url.startsWith(c))) return; // Supabase API, uploads elsewhere: always live

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
        return r;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('daw.html')))
    );
    return;
  }

  const dest = req.destination;
  if (!same || ['script', 'style', 'image', 'font', 'manifest', 'worker'].includes(dest)) {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(r => {
          if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
          return r;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
