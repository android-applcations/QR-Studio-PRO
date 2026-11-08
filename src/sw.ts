/// <reference lib="webworker" />

/**
 * QR Studio Pro — service worker (offline-first).
 *
 * This is the ONLY service worker of the app. It is written here and compiled by
 * Vite (vite-plugin-pwa `injectManifest` strategy); Workbox injects the precache
 * manifest (`self.__WB_MANIFEST`) into the compiled output at build time.
 *
 * Data safety: this worker never touches IndexedDB. Activating a new version only
 * replaces caches — the Dexie database `qr_studio_pro` is left untouched.
 */

import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
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
 * Precache everything emitted in `dist`: the HTML shell, all JS/CSS — including
 * every React.lazy chunk — plus icons and the offline fallback page.
 */
precacheAndRoute(self.__WB_MANIFEST);

/** Remove caches from older Workbox generations. IndexedDB is never touched. */
cleanupOutdatedCaches();

// ---------------------------------------------------------------------------
// Updates are explicit (registerType: "prompt"): a new worker waits until the
// user presses "Update now", so an in-flight save can never be interrupted.
// ---------------------------------------------------------------------------
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === "SKIP_WAITING") void self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Navigations: the app shell comes from the precache, so every screen —
// including the lazily imported ones — works with no network at all.
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
    plugins: [new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

// ---------------------------------------------------------------------------
// Lifecycle: take control of clients as soon as this worker is the active one.
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

clientsClaim();

export {};
