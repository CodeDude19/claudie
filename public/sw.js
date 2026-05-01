const CACHE = 'claudie-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/claudie/'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept API/search calls or cross-origin stuff — go straight to network.
  if (url.origin !== self.location.origin) return;
  if (url.hostname.includes('bedrock') || url.hostname.includes('corsproxy')) return;

  // Network-first with a cache fallback. Critically, only serve the HTML
  // fallback for navigation requests — not for assets like manifest.json
  // (which must fail cleanly if unreachable, never return the SPA shell).
  e.respondWith(
    fetch(req).catch(() => {
      if (req.mode === 'navigate') return caches.match(req) || caches.match('/claudie/');
      return caches.match(req);
    })
  );
});
