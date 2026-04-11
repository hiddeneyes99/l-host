// ── l-host Service Worker ─────────────────────────────────────────────────
//  Strategy:
//   • App shell (HTML, CSS, JS)  → Cache-first with network fallback
//   • /api/thumb + /api/preview  → Cache-first (thumbnail images)
//   • /file (video/audio)        → BYPASS SW entirely — browser handles range
//                                  requests natively; SW interception breaks
//                                  range/seek on some mobile browsers.
//   • Everything else            → Network-first
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_SHELL   = 'lhost-shell-v1';
const CACHE_THUMBS  = 'lhost-thumbs-v1';

const SHELL_ASSETS = [
  '/',
  '/app.js',
  '/style.css',
  '/index.html',
];

// ── Install: pre-cache app shell ─────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_SHELL)
      .then(c => c.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ──────────────────────────────────────────────
self.addEventListener('activate', e => {
  const keep = [CACHE_SHELL, CACHE_THUMBS];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // 1. Non-GET — never intercept (uploads, API mutations)
  if (request.method !== 'GET') return;

  // 2. Video/audio streams — let browser handle range requests natively
  const path = url.pathname;
  if (path === '/file') {
    // Only intercept downloads with dl=1 might be fine, but video ranges MUST bypass.
    // Simplest: pass everything at /file straight through.
    return;
  }

  // 3. Thumbnails → cache-first (images only change if file changes)
  if (path.startsWith('/api/thumb') ||
      path.startsWith('/api/preview')) {
    e.respondWith(cacheFirst(CACHE_THUMBS, request));
    return;
  }

  // 4. App shell assets → cache-first with network fallback
  if (SHELL_ASSETS.includes(path) || path === '/') {
    e.respondWith(cacheFirst(CACHE_SHELL, request));
    return;
  }

  // 5. Everything else (directory listings, search, etc.) → network-first
  e.respondWith(networkFirst(request));
});

// ── Helper: cache-first ───────────────────────────────────────────────────────
async function cacheFirst(cacheName, request) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (_) {
    return new Response('Offline', { status: 503 });
  }
}

// ── Helper: network-first ─────────────────────────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}
