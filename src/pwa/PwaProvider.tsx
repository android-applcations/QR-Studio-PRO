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
import { RefreshCw, X } from "lucide-react";
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

export function PwaProvider({ children }: { children: ReactNode }) {
  const swSupported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [swActive, setSwActive] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(standaloneQuery);
  const [offlineReadyDismissed, setOfflineReadyDismissed] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(false);
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
      if (!store?.persist) return false;
      if (await store.persisted()) return true;
      return await store.persist();
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
    try {
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        const timer = window.setTimeout(resolve, 20000);
        channel.port1.onmessage = () => {
          window.clearTimeout(timer);
          resolve();
        };
        try {
          sw.postMessage({ type: "ENSURE_OFFLINE" }, [channel.port2]);
        } catch {
          window.clearTimeout(timer);
          resolve();
        }
      });
    } catch {
      /* the worker is busy or gone — the next visit tries again */
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

  const hideOfflineReady = useCallback(() => {
    setOfflineReadyDismissed(true);
    setOfflineReady(false);
  }, [setOfflineReady]);

  // Re-arm the "offline ready" pill for future installs/updates.
  useEffect(() => {
    if (!offlineReady) setOfflineReadyDismissed(false);
  }, [offlineReady]);

  // Dismissing hides the prompt until the next version shows up.
  useEffect(() => {
    if (!needRefresh) setPromptDismissed(false);
  }, [needRefresh]);

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

  return (
    <PwaCtx.Provider value={value}>
      {children}
      <UpdatePrompt show={needRefresh && !promptDismissed} onUpdate={() => void updateNow()} onDismiss={() => setPromptDismissed(true)} />
    </PwaCtx.Provider>
  );
}

/**
 * "A new version is ready" with the button right on it.
 *
 * The provider is the only place that knows a worker is waiting, so the prompt
 * lives here rather than in whichever screen happens to be open. Dismissing it
 * hides it for this session; the badge on the settings icon stays until the
 * update is actually installed, so the offer never disappears for good.
 */
function UpdatePrompt({ show, onUpdate, onDismiss }: { show: boolean; onUpdate: () => void; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  const ar = typeof document !== "undefined" && document.documentElement.lang === "ar";
  if (!show) return null;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onUpdate();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="alert"
      data-testid="update-prompt"
      className="anim-sheet fixed inset-x-0 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-brand/40 bg-surface/95 p-3 shadow-2xl backdrop-blur"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
        <RefreshCw size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{ar ? "نسخة جديدة جاهزة" : "A new version is ready"}</span>
        <span className="block text-xs text-muted">{ar ? "حدّث الآن لتحصل على آخر التصحيحات والمزايا." : "Update now for the latest fixes and features."}</span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={run}
        className="press btn-primary min-h-9 shrink-0 rounded-xl bg-brand px-3 text-[13px] font-semibold text-white disabled:opacity-50"
      >
        {ar ? "تحديث الآن" : "Update now"}
      </button>
      <button type="button" onClick={onDismiss} aria-label={ar ? "لاحقاً" : "Later"} className="press min-h-9 shrink-0 rounded-xl px-2 text-muted hover:text-fg">
        <X size={18} />
      </button>
    </div>
  );
}
