import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { whenWritesIdle } from "../db/db";

export type ConnectionState = "online" | "offline" | "offline-ready" | "update-available";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface PwaCtx {
  /** navigator.onLine refined with a real network probe */
  online: boolean;
  /** single derived state used by <ConnectionStatus /> */
  state: ConnectionState;
  /** a service worker is installed and every asset is precached */
  offlineReady: boolean;
  /** verified count of the files the app needs offline (null while unknown) */
  offlineFiles: { total: number; missing: number } | null;
  /** the browser promised never to evict our cache / database (null = unknown) */
  storagePersistent: boolean | null;
  /** verify the offline cache and re-download whatever the browser evicted */
  ensureOffline: () => Promise<void>;
  /** ask the browser for durable (never-evicted) storage */
  requestPersistence: () => Promise<boolean>;
  repairing: boolean;
  /** a new version has been downloaded and is waiting */
  needRefresh: boolean;
  swSupported: boolean;
  swActive: boolean;
  /** apply the waiting update (waits for pending writes, then reloads once) */
  updateNow: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  /** show the native install prompt; false when it is unavailable */
  install: () => Promise<boolean>;
  canInstall: boolean;
  installed: boolean;
  /** iOS Safari never fires beforeinstallprompt — needs manual instructions */
  needsManualInstall: boolean;
  hideOfflineReady: () => void;
}

const PwaCtx = createContext<PwaCtx | null>(null);

export function usePwa(): PwaCtx {
  const c = useContext(PwaCtx);
  if (!c) throw new Error("PwaProvider missing");
  return c;
}

/**
 * Probe URL that is deliberately NOT precached and NOT handled by the service
 * worker (see `src/sw.ts`), so a successful fetch really means "the network works".
 */
const PROBE_PATH = "/__probe__/connectivity";

async function probeNetwork(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (typeof fetch !== "function") return typeof navigator === "undefined" ? false : navigator.onLine;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      await fetch(`${window.location.origin}${PROBE_PATH}?t=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        mode: "same-origin",
        credentials: "omit",
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    return true;
  } catch {
    // fetch rejects on DNS failure, captive portals, airplane mode, …
    return false;
  }
}

const standaloneQuery = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

const isIos = () =>
  typeof navigator !== "undefined" &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && (navigator as Navigator).maxTouchPoints > 1));

/** Mirrors `OfflineStatus` in `src/sw.ts`. Declared locally so the app bundle
 *  never has to import the service worker (and with it Workbox). */
interface OfflineStatus {
  total: number;
  missing: number;
  repaired: number;
  broken: number;
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const swSupported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [swActive, setSwActive] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(standaloneQuery);
  const [offlineReadyDismissed, setOfflineReadyDismissed] = useState(false);
  const [offlineFiles, setOfflineFiles] = useState<{ total: number; missing: number } | null>(null);
  const [storagePersistent, setStoragePersistent] = useState<boolean | null>(null);
  const [repairing, setRepairing] = useState(false);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      registration.current = reg ?? null;
      setSwActive(!!navigator.serviceWorker?.controller || (reg?.active ?? null) !== null);
    },
    onRegisterError(error) {
      console.error("Service worker registration failed", error);
    },
    // Only reload once IndexedDB is quiet: never interrupt a save in progress.
    onNeedReload() {
      void whenWritesIdle(8000).then(() => window.location.reload());
    },
  });

  // ---------- connectivity ----------
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    const run = async () => {
      const ok = await probeNetwork();
      if (!alive) return;
      setOnline(ok);
      // Poll faster while we believe we are offline.
      timer = window.setTimeout(run, ok ? 60_000 : 15_000);
    };

    const immediate = () => {
      if (navigator.onLine === false) {
        setOnline(false);
        window.clearTimeout(timer);
        timer = window.setTimeout(run, 15_000);
      } else {
        void run();
      }
    };

    window.addEventListener("online", immediate);
    window.addEventListener("offline", immediate);
    const onVisible = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    void run();

    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("online", immediate);
      window.removeEventListener("offline", immediate);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // ---------- service worker state ----------
  useEffect(() => {
    if (!swSupported) return;
    const sync = () => setSwActive(!!navigator.serviceWorker.controller);
    sync();
    navigator.serviceWorker.addEventListener("controllerchange", sync);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", sync);
  }, [swSupported]);

  // ---------- install ----------
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setCanInstall(false);
      deferred.current = null;
    };
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMode = () => setInstalled(standaloneQuery());

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    mq.addEventListener("change", onMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener("change", onMode);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    const e = deferred.current;
    if (!e) return false;
    deferred.current = null;
    setCanInstall(false);
    try {
      await e.prompt();
      const choice = await e.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      else if (standaloneQuery()) setInstalled(true);
      return choice.outcome === "accepted";
    } catch {
      return false;
    }
  }, []);

  const updateNow = useCallback(async () => {
    // 1. let every pending IndexedDB write settle (never reload mid-save)
    await whenWritesIdle(8000);
    // 2. tell the waiting worker to activate; `onNeedReload` reloads when idle
    await updateServiceWorker(true);
  }, [updateServiceWorker]);

  const checkForUpdates = useCallback(async () => {
    if (!swSupported) return;
    try {
      const reg = registration.current ?? (await navigator.serviceWorker.getRegistration());
      registration.current = reg ?? null;
      await reg?.update();
    } catch {
      /* offline — nothing to check */
    }
  }, [swSupported]);

  /**
   * Ask the browser to make our storage durable.
   *
   * Without it the browser may throw away the offline cache (and the IndexedDB
   * database) whenever the device is short on space — which is exactly how an
   * app that worked offline yesterday stops working today.
   */
  const requestPersistence = useCallback(async (): Promise<boolean> => {
    try {
      const store = navigator.storage;
      if (!store?.persist) {
        setStoragePersistent(false);
        return false;
      }
      if (await store.persisted()) {
        setStoragePersistent(true);
        return true;
      }
      const granted = await store.persist();
      setStoragePersistent(granted);
      return granted;
    } catch {
      return false;
    }
  }, []);

  /**
   * Verify every precached file and re-download the ones that went missing.
   * Runs on start-up and whenever the connection comes back, so a cache the
   * browser evicted — or a first visit that was interrupted — repairs itself.
   */
  const ensureOffline = useCallback(async (): Promise<void> => {
    void requestPersistence();
    const sw = navigator.serviceWorker?.controller;
    if (!sw) return;
    setRepairing(true);
    try {
      const status = await new Promise<OfflineStatus | null>((resolve) => {
        const channel = new MessageChannel();
        const timer = window.setTimeout(() => resolve(null), 20000);
        channel.port1.onmessage = (event: MessageEvent) => {
          window.clearTimeout(timer);
          const data = event.data as { status?: OfflineStatus } | null;
          resolve(data?.status ?? null);
        };
        try {
          sw.postMessage({ type: "ENSURE_OFFLINE" }, [channel.port2]);
        } catch {
          window.clearTimeout(timer);
          resolve(null);
        }
      });
      if (status) setOfflineFiles({ total: status.total, missing: status.broken });
    } catch {
      /* the worker is busy or gone — the next visit tries again */
    } finally {
      setRepairing(false);
    }
  }, [requestPersistence]);

  // Ask for durable storage as early as we can.
  useEffect(() => {
    void requestPersistence();
  }, [requestPersistence]);

  // Verify (and silently repair) the offline cache on start-up and every time we
  // come back online.
  useEffect(() => {
    if (!swSupported || !online || !swActive) return;
    const timer = window.setTimeout(() => void ensureOffline(), 1500);
    return () => window.clearTimeout(timer);
  }, [swSupported, online, swActive, ensureOffline]);

  // The worker also pushes a status on its own (right after it activates).
  useEffect(() => {
    if (!swSupported) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; status?: OfflineStatus } | null;
      if (data?.type !== "OFFLINE_STATUS" || !data.status) return;
      setOfflineFiles({ total: data.status.total, missing: data.status.broken });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [swSupported]);

  const hideOfflineReady = useCallback(() => {
    setOfflineReadyDismissed(true);
    setOfflineReady(false);
  }, [setOfflineReady]);

  // Re-arm the "offline ready" pill for future installs/updates.
  useEffect(() => {
    if (!offlineReady) setOfflineReadyDismissed(false);
  }, [offlineReady]);

  const state: ConnectionState = !online
    ? "offline"
    : needRefresh
      ? "update-available"
      : offlineReady && !offlineReadyDismissed && swActive
        ? "offline-ready"
        : "online";

  const value = useMemo<PwaCtx>(
    () => ({
      online,
      state,
      offlineReady: offlineReady && !offlineReadyDismissed,
      offlineFiles,
      storagePersistent,
      ensureOffline,
      requestPersistence,
      repairing,
      needRefresh,
      swSupported,
      swActive,
      updateNow,
      checkForUpdates,
      install,
      canInstall: canInstall && !installed,
      installed,
      needsManualInstall: isIos() && !installed && !canInstall,
      hideOfflineReady,
    }),
    [
      online,
      state,
      offlineReady,
      offlineReadyDismissed,
      offlineFiles,
      storagePersistent,
      ensureOffline,
      requestPersistence,
      repairing,
      needRefresh,
      swSupported,
      swActive,
      updateNow,
      checkForUpdates,
      install,
      canInstall,
      installed,
      hideOfflineReady,
    ],
  );

  return <PwaCtx.Provider value={value}>{children}</PwaCtx.Provider>;
}
