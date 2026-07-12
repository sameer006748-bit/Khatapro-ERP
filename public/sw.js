// KhataPro ERP — Service Worker (Secure)
// Caches ONLY explicit public static assets. NEVER caches navigation HTML,
// API responses, Supabase requests, or auth routes.

const SW_VERSION = 'v1.1.0';
const SHELL_CACHE = `khatapro-shell-${SW_VERSION}`;
const OFFLINE_URL = '/offline';

// ─── Explicit allowlist — ONLY these are cached ──────────────────
// No navigation HTML, no API responses, no auth routes.
const CACHE_ALLOWLIST = [
  '/offline',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/maskable-512.png',
  '/icon.svg',
  '/favicon.ico',
  '/favicon-32.png',
  '/favicon-16.png',
  '/apple-touch-icon.png',
];

// ─── Denylist — NEVER cache these (defense in depth) ─────────────
const CACHE_DENYLIST_PATTERNS = [
  /^\/api\//,          // All API routes (financial data, auth)
  /^\/auth\//,         // NextAuth routes
  /^\/offline$/,       // Offline page itself is in allowlist but we don't cache navigations
];

function isSupabaseRequest(url) {
  return url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in');
}

function isDenied(url) {
  if (isSupabaseRequest(url)) return true;
  return CACHE_DENYLIST_PATTERNS.some((p) => p.test(url.pathname));
}

function isAllowedStatic(url) {
  return CACHE_ALLOWLIST.includes(url.pathname);
}

// ─── Install — pre-cache ONLY explicit static assets ─────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(CACHE_ALLOWLIST))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate — clean old caches ─────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch strategy ──────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET.
  if (req.method !== 'GET') return;

  // NEVER intercept: API, Supabase, auth routes — let browser handle.
  if (isDenied(url)) return;

  // Navigation requests (HTML pages):
  //   Try network. On failure, show /offline. NEVER cache the navigation response.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Allowed static assets: cache-first (they're immutable versioned files or icons).
  if (isAllowedStatic(url) && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Same-origin static assets (JS/CSS/fonts from Next.js build): stale-while-revalidate.
  // These are fingerprinted/immutable so safe to cache.
  if (url.origin === self.location.origin && (req.destination === 'script' || req.destination === 'style' || req.destination === 'font')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Everything else: browser default (no caching).
});

// ─── Message handler — for update flow ───────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
