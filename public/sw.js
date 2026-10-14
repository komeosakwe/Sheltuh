/*
 * Sheltüh service worker. Read docs/pwa.md ("Caching design") before
 * changing this file, and bump VERSION when the caches or the precached
 * files change.
 *
 * In short: it caches public, content-hashed build output and public images,
 * and never pages, API responses or anything cross-origin. Page navigations
 * go to the network and fall back to /offline.html when there is no
 * connection. It never calls skipWaiting() or clients.claim(), so an update
 * can't reload or take over a page mid-checkout or mid-message.
 *
 * tests/service-worker.test.ts runs this file in a sandbox: keep the routing
 * rules in the plain functions below.
 */

const VERSION = "v1";
const CACHE_PREFIX = "sheltuh-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${VERSION}`;
const IMAGE_CACHE = `${CACHE_PREFIX}images-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, STATIC_CACHE, IMAGE_CACHE];

const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [OFFLINE_URL];

const DAY_MS = 24 * 60 * 60 * 1000;
const LIMITS = {
  [STATIC_CACHE]: { maxEntries: 150, maxAgeMs: 30 * DAY_MS },
  [IMAGE_CACHE]: { maxEntries: 60, maxAgeMs: 7 * DAY_MS },
};
const CACHED_AT_HEADER = "x-sw-cached-at";

const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|avif|gif|svg|ico)$/i;
/** Same-origin paths that must never be intercepted, whatever the request. */
const NEVER_INTERCEPT = [
  /^\/api(?:\/|$)/,
  /^\/_next\/image(?:\/|$)/,
  // Supabase's API prefixes, in case one is ever proxied through this origin.
  /^\/(?:auth|rest|storage|realtime|functions)\/v1(?:\/|$)/,
  /^\/supabase/,
  /^\/sw\.js$/,
  /^\/manifest\.webmanifest$/,
];

/**
 * How a request is handled:
 * - "navigate": network only; /offline.html if the network fails; never stored.
 * - "static": hashed build output; cache first.
 * - "image": same-origin public image; stale-while-revalidate.
 * - "bypass": not intercepted at all (the browser handles it as if there
 *   were no service worker).
 */
function routeFor(request, origin) {
  if (request.method !== "GET") return "bypass";

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return "bypass";
  }
  if (url.origin !== origin) return "bypass";
  if (NEVER_INTERCEPT.some((pattern) => pattern.test(url.pathname))) return "bypass";

  if (request.mode === "navigate") return "navigate";

  // Credentialed, partial or React Server Component requests carry page data.
  const headers = request.headers;
  if (headers.has("authorization") || headers.has("range") || headers.has("rsc")) return "bypass";
  if (url.searchParams.has("_rsc")) return "bypass";

  if (url.pathname.startsWith("/_next/static/")) return "static";
  if (request.destination === "image" && IMAGE_EXTENSION.test(url.pathname)) return "image";
  return "bypass";
}

/** Only complete, same-origin, shareable responses are stored. */
function isCacheable(response) {
  if (!response || response.status !== 200 || response.type !== "basic") return false;
  const cacheControl = response.headers.get("cache-control") || "";
  return !/\b(?:no-store|private)\b/i.test(cacheControl);
}

function isFresh(response, maxAgeMs, now) {
  const cachedAt = Number(response.headers.get(CACHED_AT_HEADER));
  return Number.isFinite(cachedAt) && cachedAt > 0 && now - cachedAt <= maxAgeMs;
}

/** A copy of the response with the time it was stored, for the age limit. */
function stamp(response, now) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(now));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function trim(cacheName) {
  const { maxEntries } = LIMITS[cacheName];
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  // Cache keys come back oldest write first.
  for (let i = 0; i < keys.length - maxEntries; i += 1) {
    await cache.delete(keys[i]);
  }
}

async function store(cacheName, request, response) {
  if (!isCacheable(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, stamp(response, Date.now()));
  await trim(cacheName);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached && isFresh(cached, LIMITS[cacheName].maxAgeMs, Date.now())) return cached;
  try {
    const response = await fetch(request);
    await store(cacheName, request, response.clone());
    return response;
  } catch (error) {
    // Offline: an expired copy beats nothing.
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(event, cacheName) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    await store(cacheName, request, response.clone());
    return response;
  });
  if (cached && isFresh(cached, LIMITS[cacheName].maxAgeMs, Date.now())) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  try {
    return await network;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

async function networkWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const offline = await (await caches.open(SHELL_CACHE)).match(OFFLINE_URL);
    if (offline) return offline;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.includes(key))
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const route = routeFor(event.request, self.location.origin);
  if (route === "navigate") event.respondWith(networkWithOfflineFallback(event.request));
  else if (route === "static") event.respondWith(cacheFirst(event.request, STATIC_CACHE));
  else if (route === "image") event.respondWith(staleWhileRevalidate(event, IMAGE_CACHE));
  // "bypass": no respondWith, so the browser fetches it normally.
});
