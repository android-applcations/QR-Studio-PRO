import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Screen-level code splitting.
 *
 * The app shells out one screen at a time, but all six shipped in a single
 * bundle, so a first visit downloaded the scanner, the library, the history and
 * the templates before it could show the create screen. Each of those now loads
 * when it is first opened.
 *
 * The catch — and the reason this was avoided before — is offline. A lazy chunk
 * lives in the service worker's precache like every other file, and a browser
 * under storage pressure may evict it; a screen that cannot load its chunk is a
 * screen that will not open even though the rest of the app is running.
 *
 * `prefetchScreens` answers that: once the app is up and the browser is idle,
 * every screen chunk is fetched into the same cache. After that the app is as
 * offline-proof as it was as a single bundle, only with a much smaller first
 * download.
 */

const loaders: Record<string, () => Promise<{ default: ComponentType<Record<string, never>> }>> = {
  design: () => import("./DesignEditor"),
  scan: () => import("./ScannerScreen"),
  library: () => import("./LibraryScreen"),
  history: () => import("./HistoryScreen"),
  templates: () => import("./TemplatesScreen"),
};

export const Screens: Record<string, LazyExoticComponent<ComponentType<Record<string, never>>>> = {
  design: lazy(loaders.design),
  scan: lazy(loaders.scan),
  library: lazy(loaders.library),
  history: lazy(loaders.history),
  templates: lazy(loaders.templates),
};

let warmed = false;

/**
 * Pull every screen chunk into cache while nothing else is happening.
 *
 * Called once, after the first paint, and again if the app is still open a
 * while later — a phone that was offline at boot gets another chance to fill
 * the gaps.
 */
export function prefetchScreens(): void {
  if (warmed) return;
  warmed = true;
  const run = () => {
    for (const load of Object.values(loaders)) {
      load().catch(() => {
        /* a chunk that will not fetch now is fetched again next time */
      });
    }
  };
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === "function") idle(run, { timeout: 6000 });
  else setTimeout(run, 2500);
}
