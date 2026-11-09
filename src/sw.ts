/// <reference lib="webworker" />

/**
 * QR Studio Pro — service worker (offline-first).
 *
 * This is the ONLY service worker of the app. It is written here and compiled by
 * Vite (vite-plugin-pwa `injectManifest` strategy); Workbox injects the precache
 * manifest (`__WB_MANIFEST`) into the compiled output at build time.
 *
 * Data safety: this worker never touches IndexedDB. Activating a new version only
 * replaces caches — the Dexie database `qr_studio_pro` is left untouched.
 */

import { cacheNames, clientsClaim } from "workbox-core";
import {
  addRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  getCacheKeyForURL,
  matchPrecache,
  precache,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
};

/** Self-contained fallback page (bilingual, no external resources). */
const OFFLINE_URL = "offline.html";
const RUNTIME_CACHE = "qr-studio-runtime";

/**
 * Workbox injects the precache manifest by string-replacing the well-known
 * manifest token, so that exact token may appear only once in this file.
 * It is captured here and reused everywhere else.
 */
const WB_MANIFEST = self.__WB_MANIFEST;

// ---------------------------------------------------------------------------
// 1. The precache list and its install/activate listeners come first.
//
// `createHandlerBoundToURL()` validates at *creation* time that the URL is in
// the list, so the list has to exist before the navigation handler is built.
//
// `precache()` (not `precacheAndRoute()`) is used on purpose: it registers the
// list and the lifecycle listeners but NOT the route, so we can decide exactly
// where that route goes — see step 3.
// ---------------------------------------------------------------------------
precache(WB_MANIFEST);

/** Remove caches from older Workbox generations. IndexedDB is never touched. */
cleanupOutdatedCaches();

// ---------------------------------------------------------------------------
// 2. Navigations, registered BEFORE the precache route.
//
// The app shell comes from the precache, so the whole app works with no network
// at all. Order matters: Workbox's precache route answers `/` from the precache
// but falls back to the network on a cache miss, and a route match stops the
// router from ever trying a later route. If the browser wipes the cache (it does
// that when the device is short on storage) that network fallback throws and the
// user ends up on the browser's "no internet" error page instead of ours. With
// navigations handled first, a miss falls through to `offline.html` and then to
// a self-contained inline page.
// ---------------------------------------------------------------------------
const serveShell = createHandlerBoundToURL("index.html");
const serveOfflinePage = createHandlerBoundToURL(OFFLINE_URL);

registerRoute(
  new NavigationRoute(
    async (context) => {
      try {
        return await serveShell(context);
      } catch {
        /* shell not in the precache (yet) — try the standalone offline page */
      }
      try {
        return await serveOfflinePage(context);
      } catch {
        /* nothing cached — last-resort inline response */
      }
      return new Response(
        "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
          "<title>QR Studio Pro</title>" +
          "<body style=\"margin:0;display:grid;place-items:center;height:100vh;font-family:system-ui,sans-serif;background:#090a10;color:#eef0f7;text-align:center;padding:1.5rem\">" +
          "<div><p style=\"font-size:18px;font-weight:700\">QR Studio Pro</p>" +
          "<p style=\"color:#8f94a8\">You are offline. / أنت غير متصل بالإنترنت.</p></div></body>",
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    },
    {
      // Never turn asset/API requests into HTML documents.
      denylist: [/^\/api\//, /^\/assets\//, /^\/icons\//, /^\/__probe__\//, /\.[a-z0-9]+$/i],
    },
  ),
);

// ---------------------------------------------------------------------------
// 3. Route for the precached static assets, registered last (see step 2).
// ---------------------------------------------------------------------------
addRoute();

// ---------------------------------------------------------------------------
// Self-healing precache.
//
// Browsers evict a site's storage when the device runs low on space (iOS Safari
// does it aggressively, and it is not limited to installed apps). When that
// happens offline quietly breaks: the shell still loads but parts of the app
// die. So instead of trusting the cache once and forever, the worker *verifies*
// every precached file on activation and whenever the app asks it to, and
// re-downloads whatever went missing. The app uses the report to tell the user
// the truth instead of claiming everything is fine.
// ---------------------------------------------------------------------------
export interface OfflineStatus {
  /** files the build declared */
  total: number;
  /** files that were NOT in the cache when we looked */
  missing: number;
  /** files we managed to re-download just now */
  repaired: number;
  /** still missing after the repair attempt (almost always "we are offline") */
  broken: number;
}

const manifestURLs = (): string[] =>
  (WB_MANIFEST ?? []).map((entry) => (typeof entry === "string" ? entry : entry.url));

async function ensureOfflineAssets(): Promise<OfflineStatus> {
  const urls = manifestURLs();
  let missing = 0;
  let repaired = 0;

  for (const url of urls) {
    let present = false;
    try {
      present = (await matchPrecache(url)) !== undefined;
    } catch {
      present = false;
    }
    if (present) continue;

    missing++;
    try {
      const cacheKey = getCacheKeyForURL(url);
      if (!cacheKey) continue;
      const response = await fetch(new Request(url, { cache: "reload", credentials: "same-origin" }));
      if (!response.ok) continue;
      const cache = await caches.open(cacheNames.precache);
      await cache.put(cacheKey, response);
      repaired++;
    } catch {
      // Offline (or the file is gone): it will be picked up on the next visit.
    }
  }

  return { total: urls.length, missing, repaired, broken: missing - repaired };
}

// ---------------------------------------------------------------------------
// Updates are explicit (registerType: "prompt"): a new worker waits until the
// user presses "Update now", so an in-flight save can never be interrupted.
// `ENSURE_OFFLINE` lets the page ask for a verification + repair run.
// ---------------------------------------------------------------------------
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === "SKIP_WAITING") void self.skipWaiting();
  if (data?.type === "ENSURE_OFFLINE") {
    const reply = event.ports?.[0];
    event.waitUntil(
      ensureOfflineAssets().then((status) => {
        reply?.postMessage({ type: "OFFLINE_STATUS", status });
      }),
    );
  }
});

// ---------------------------------------------------------------------------
// Safety net for same-origin static assets that are not part of the precache.
// ---------------------------------------------------------------------------
registerRoute(
  ({ request, sameOrigin, url }) =>
    sameOrigin &&
    request.method === "GET" &&
    request.destination !== "document" &&
    // the connectivity probe must always hit the network
    !url.pathname.startsWith("/__probe__/"),
  new StaleWhileRevalidate({
    cacheName: RUNTIME_CACHE,
    // purgeOnQuotaError: when the device runs out of space, drop this cache
    // rather than let the browser evict the precache the app needs to start.
    plugins: [new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true })],
  }),
);

// ---------------------------------------------------------------------------
// Lifecycle: take control of clients as soon as this worker is the active one.
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Take control of the very first page immediately, so a first-time visitor
      // is already protected before they navigate anywhere.
      await self.clients.claim();
      // Top up anything the browser evicted since the last visit.
      await ensureOfflineAssets();
    })(),
  );
});

clientsClaim();

export {};
