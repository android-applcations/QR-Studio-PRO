import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { CloudOff, Clock, HardDrive, LayoutTemplate, Library, Palette, QrCode, RefreshCw, ScanLine, Settings, Sparkles, Wifi, WifiOff } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import type { SectionId } from "./core/types";
import { T } from "./core/i18n";
import { loadSettings, storageEstimate } from "./db/db";
import { formatBytes } from "./core/i18n";
import { AppProvider, useApp } from "./state/AppContext";
import { ProjectProvider } from "./state/ProjectContext";
import { cn } from "./utils/cn";
import CreateScreen from "./components/CreateScreen";
import { ConfirmHost, IconBtn, Spinner, ToastHost } from "./components/ui";
import { SettingsSheet } from "./components/SettingsSheet";

const DesignEditor = lazy(() => import("./components/DesignEditor"));
const ScannerScreen = lazy(() => import("./components/ScannerScreen"));
const LibraryScreen = lazy(() => import("./components/LibraryScreen"));
const HistoryScreen = lazy(() => import("./components/HistoryScreen"));
const TemplatesScreen = lazy(() => import("./components/TemplatesScreen"));

const NAV: { id: SectionId; label: readonly [string, string]; icon: typeof QrCode }[] = [
  { id: "create", label: T.create, icon: Sparkles },
  { id: "design", label: T.design, icon: Palette },
  { id: "scan", label: T.scan, icon: ScanLine },
  { id: "library", label: T.library, icon: Library },
  { id: "history", label: T.history, icon: Clock },
  { id: "templates", label: T.templates, icon: LayoutTemplate },
];

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

class Boundary extends Component<{ children: ReactNode; onReset: () => void }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() {
    return { err: true };
  }
  componentDidCatch(e: Error, info: ErrorInfo) {
    console.error(e, info);
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted">Something went wrong · حدث خطأ غير متوقع</p>
        <button type="button" className="press min-h-11 rounded-xl bg-brand px-5 text-white" onClick={() => { this.setState({ err: false }); this.props.onReset(); }}>
          OK
        </button>
      </div>
    );
  }
}

function PwaStatus() {
  const { t, toast } = useApp();
  const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW();
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [displayMode, setDisplayMode] = useState<"standalone" | "browser">(
    typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser",
  );

  useEffect(() => {
    const updateOnlineState = () => setOnline(navigator.onLine);
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setInstallPrompt(null);
      setDisplayMode("standalone");
    };

    const media = window.matchMedia("(display-mode: standalone)");
    const syncDisplayMode = () => setDisplayMode(media.matches ? "standalone" : "browser");

    updateOnlineState();
    syncDisplayMode();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    media.addEventListener("change", syncDisplayMode);

    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      media.removeEventListener("change", syncDisplayMode);
    };
  }, []);

  useEffect(() => {
    if (offlineReady) {
      toast(t(["App ready for offline use", "التطبيق جاهز للاستخدام دون الإنترنت"]), "ok");
    }
  }, [offlineReady, t, toast]);

  const statusText = needRefresh
    ? t(["Update available", "تحديث متاح"])
    : offlineReady
      ? t(["Installing", "جارٍ التثبيت"])
      : online
        ? t(["Online", "متصل"])
        : t(["Offline", "غير متصل"]);

  const statusColor = needRefresh ? "bg-warn" : offlineReady ? "bg-brand" : online ? "bg-ok" : "bg-bad";

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface2/70 px-2.5 py-1 text-[11px] font-medium text-muted">
        <span className={cn("h-2 w-2 rounded-full", statusColor)} />
        <span>{statusText}</span>
      </div>
      {installPrompt && displayMode !== "standalone" && (
        <button
          type="button"
          onClick={() => {
            void installPrompt.prompt();
            setInstallPrompt(null);
          }}
          className="press rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-white"
        >
          {t(["Install", "تثبيت"]) }
        </button>
      )}
      {needRefresh && (
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="press flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand"
        >
          <RefreshCw size={12} />
          {t(["Update now", "تحديث الآن"])}
        </button>
      )}
      {!online && <CloudOff size={14} className="text-bad" />}
    </div>
  );
}

function StorageChip() {
  const { t, dataVersion, setSettingsOpen } = useApp();
  const [s, setS] = useState<{ usage: number; quota: number } | null | undefined>(undefined);
  useEffect(() => {
    const id = setTimeout(() => storageEstimate().then(setS), 300);
    return () => clearTimeout(id);
  }, [dataVersion]);
  const pct = s && s.quota ? (s.usage / s.quota) * 100 : 0;
  return (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      title={t(["Local storage status", "حالة التخزين المحلي"])}
      aria-label={t(["Local storage status", "حالة التخزين المحلي"])}
      className="press hidden min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface2/60 px-3 text-[12px] text-muted sm:flex"
    >
      <HardDrive size={14} />
      <span className={cn("h-2 w-2 rounded-full", s === null ? "bg-warn" : pct > 85 ? "bg-bad" : "bg-ok")} />
      <span dir="ltr" className="tabular-nums">{s ? formatBytes(s.usage) : s === null ? "IndexedDB" : "…"}</span>
    </button>
  );
}

function Shell() {
  const { t, lang, setLang, section, go, setSettingsOpen } = useApp();
  const [boundaryKey, setBoundaryKey] = useState(0);

  const screen = (() => {
    switch (section) {
      case "design": return <DesignEditor />;
      case "scan": return <ScannerScreen />;
      case "library": return <LibraryScreen />;
      case "history": return <HistoryScreen />;
      case "templates": return <TemplatesScreen />;
      default: return <CreateScreen />;
    }
  })();

  return (
    <div className="fixed inset-0 flex flex-col bg-bg text-fg" style={{ paddingTop: "env(safe-area-inset-top)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface/90 px-3 md:px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand2 text-white shadow-[0_6px_16px_-6px_var(--c-brand)]"><QrCode size={20} /></div>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-extrabold tracking-tight">QR Studio <span className="text-brand">Pro</span></h1>
        <div className="hidden sm:flex"><PwaStatus /></div>
        <StorageChip />
        <button type="button" onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="press min-h-10 min-w-10 rounded-xl border border-line bg-surface2/60 px-3 text-sm font-bold" aria-label={t(["Switch language", "تبديل اللغة"]) }>
          {lang === "ar" ? "EN" : "ع"}
        </button>
        <IconBtn label={t(T.settings)} onClick={() => setSettingsOpen(true)}><Settings size={22} /></IconBtn>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label={t(["Main navigation", "التنقل الرئيسي"])} className="hidden w-[84px] shrink-0 flex-col items-stretch gap-1 border-e border-line bg-surface/60 p-2 md:flex lg:[...]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          {NAV.map((n) => (
            <button key={n.id} type="button" onClick={() => go(n.id)} aria-current={section === n.id ? "page" : undefined} className={cn("press flex min-h-12 items-center justify-center gap-3 rounded-xl border text-sm font-medium", section === n.id ? "border-brand/40 bg-brand/10 text-brand" : "border-transparent bg-transparent text-muted hover:border-line hover:bg-surface2/60")}>
              <n.icon size={21} />
              <span className="hidden lg:inline">{t(n.label)}</span>
            </button>
          ))}
        </nav>

        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <Boundary key={boundaryKey} onReset={() => { setBoundaryKey((k) => k + 1); go("create"); }}>
            <div key={section} className="anim-fade-in h-full">
              <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-muted"><Spinner />{t(T.loading)}</div>}>
                {screen}
              </Suspense>
            </div>
          </Boundary>
        </main>
      </div>

      <nav aria-label={t(["Main navigation", "التنقل الرئيسي"])} className="flex shrink-0 border-t border-line bg-surface md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {NAV.map((n) => (
          <button key={n.id} type="button" onClick={() => go(n.id)} aria-current={section === n.id ? "page" : undefined} className={cn("press relative flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium", section === n.id ? "text-brand" : "text-muted")}>
            {section === n.id && <span className="anim-fade-in absolute top-0 h-0.5 w-8 rounded-full bg-brand" />}
            <n.icon size={22} strokeWidth={section === n.id ? 2.4 : 2} />
            <span className="max-w-full truncate px-0.5">{t(n.label)}</span>
          </button>
        ))}
      </nav>

      <SettingsSheet />
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}

export default function App() {
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let alive = true;
    loadSettings()
      .then((s) => alive && setInitial(s))
      .catch((e) => {
        console.error("IndexedDB unavailable", e);
        if (alive) setInitial({});
      });
    return () => { alive = false; };
  }, []);

  if (!initial) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-bg text-brand"><Spinner size={28} /></div>
    );
  }
  return (
    <AppProvider initial={initial}>
      <ProjectProvider initial={initial}>
        <Shell />
      </ProjectProvider>
    </AppProvider>
  );
}
