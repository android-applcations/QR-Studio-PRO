import { Component, Suspense, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Clock, HardDrive, LayoutTemplate, Library, Palette, QrCode, ScanLine, Settings, Sparkles } from "lucide-react";
import type { SectionId } from "./core/types";
import { T } from "./core/i18n";
import { loadSettings, pruneOldest, storageAudit, storageEstimate } from "./db/db";
import { formatBytes } from "./core/i18n";
import { AppProvider, useApp } from "./state/AppContext";
import { ProjectProvider } from "./state/ProjectContext";
import { cn } from "./utils/cn";
import { playSound } from "./core/sound";
import { usePwa } from "./pwa/PwaProvider";
// The create screen ships with the shell: it is what a first-time visitor sees,
// so it must not wait for a second download. The rest load on first use and are
// warmed into the cache right after boot (see `screens.tsx`).
import CreateScreen from "./components/CreateScreen";
import { prefetchScreens, Screens } from "./components/screens";
import { ConfirmHost, IconBtn, Spinner, ToastHost, UpdateBadge } from "./components/ui";
import { SettingsSheet } from "./components/SettingsSheet";
import ConnectionStatus from "./components/ConnectionStatus";
import InstallButton from "./components/InstallButton";


const NAV: { id: SectionId; label: readonly [string, string]; icon: typeof QrCode }[] = [
  { id: "create", label: T.create, icon: Sparkles },
  { id: "design", label: T.design, icon: Palette },
  { id: "scan", label: T.scan, icon: ScanLine },
  { id: "library", label: T.library, icon: Library },
  { id: "history", label: T.history, icon: Clock },
  { id: "templates", label: T.templates, icon: LayoutTemplate },
];

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
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="press min-h-11 rounded-xl bg-brand px-5 text-white"
            onClick={() => {
              this.setState({ err: false });
              this.props.onReset();
            }}
          >
            Retry · إعادة المحاولة
          </button>
          <button type="button" className="press min-h-11 rounded-xl border border-line px-5" onClick={() => window.location.reload()}>
            Reload app · إعادة تحميل التطبيق
          </button>
        </div>
      </div>
    );
  }
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

/**
 * Warn before the browser runs out of room, and offer the two ways out.
 *
 * Codes, logos, scan history and the offline cache all share one bucket, and a
 * browser that fills it starts failing writes silently — a code you saved
 * simply is not there next time. So once the bucket is nearly full we say so,
 * with a backup button and a "clean up" button on the same toast.
 */
function useStorageGuard() {
  const { t, dataVersion, toast, fail } = useApp();
  const warned = useRef(false);
  useEffect(() => {
    if (warned.current) return;
    let alive = true;
    const id = setTimeout(async () => {
      try {
        const a = await storageAudit();
        if (!alive || a.percent === null || a.percent < 85) return;
        warned.current = true;
        toast(
          t([
            `Storage is ${Math.round(a.percent)}% full. Export a backup or clear old codes to keep saving.`,
            `التخزين ممتلئ بنسبة ${Math.round(a.percent)}٪. صدّر نسخة احتياطية أو احذف الرموز القديمة لتتمكن من الحفظ.`,
          ]),
          "info",
          {
            label: t(["Clean old codes", "تنظيف الرموز القديمة"]),
            run: async () => {
              try {
                const gone = await pruneOldest();
                bumpAll();
                toast(
                  gone.codes || gone.history
                    ? t([`Freed space: removed ${gone.codes} old codes and ${gone.history} history entries.`, `تم تحرير المساحة: حُذف ${gone.codes} رمزاً قديماً و${gone.history} من السجل.`])
                    : t(["Nothing old enough to remove — favourites are kept.", "لا شيء قديم للحذف — الرموز المفضلة محفوظة."]),
                  "info",
                );
              } catch (e) {
                fail(e);
              }
            },
          },
        );
      } catch {
        /* storage audit is best-effort */
      }
    }, 2500);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [dataVersion, t, toast, fail]);
}

/** Re-render every list once storage has been cleaned. */
let bumpAll = () => {};

function Shell() {
  const { t, lang, setLang, section, go, setSettingsOpen, bumpData } = useApp();
  // True only once a new version has finished downloading and is waiting.
  const { needRefresh } = usePwa();
  const [boundaryKey, setBoundaryKey] = useState(0);
  useStorageGuard();
  bumpAll = bumpData;

  // Only the section change makes a sound: navigating is a distinct action.
  const navigate = (id: SectionId) => {
    if (id !== section) playSound("nav");
    go(id);
  };

  const screen = (() => {
    if (section === "create") return <CreateScreen />;
    const Screen = Screens[section];
    return Screen ? <Screen /> : <CreateScreen />;
  })();

  // Warm the other screens into the precache once the shell is on screen, so a
  // trip through a tunnel is no worse than it was when they all shipped in it.
  useEffect(() => {
    const id = setTimeout(prefetchScreens, 1200);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col bg-bg text-fg" style={{ paddingTop: "env(safe-area-inset-top)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface/90 px-3 md:px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand2 text-white shadow-[0_6px_16px_-6px_var(--c-brand)]"><QrCode size={20} /></div>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-extrabold tracking-tight">QR Studio <span className="text-brand">Pro</span></h1>
        <ConnectionStatus className="hidden md:flex" />
        <StorageChip />
        <InstallButton compact />
        <button type="button" onClick={() => { playSound("nav"); setLang(lang === "ar" ? "en" : "ar"); }} className="press min-h-10 min-w-10 rounded-xl border border-line bg-surface2/60 px-3 text-sm font-bold" aria-label={t(["Switch language", "تبديل اللغة"])} title={t(["Switch language", "تبديل اللغة"])}>
          {lang === "ar" ? "EN" : "ع"}
        </button>
        {/* The red pill sits on the settings icon so the update is impossible to
            miss, and it is dropped the moment the update is installed. */}
        <div className="relative shrink-0">
          <IconBtn label={t(T.settings)} onClick={() => setSettingsOpen(true)}><Settings size={22} /></IconBtn>
          {needRefresh && <UpdateBadge className="pointer-events-none absolute -top-1.5 end-0" />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Side navigation (tablet / desktop) */}
        <nav aria-label={t(["Main navigation", "التنقل الرئيسي"])} className="hidden w-[84px] shrink-0 flex-col items-stretch gap-1 border-e border-line bg-surface/60 p-2 md:flex lg:w-[200px]">
          {NAV.map((n) => (
            <button key={n.id} type="button" onClick={() => navigate(n.id)} aria-current={section === n.id ? "page" : undefined} className={cn("press flex min-h-12 items-center justify-center gap-3 rounded-xl px-2 text-[13px] font-medium lg:justify-start lg:px-3.5", section === n.id ? "bg-brand/15 text-brand" : "text-muted hover:bg-surface2 hover:text-fg")}>
              <n.icon size={21} />
              <span className="hidden lg:inline">{t(n.label)}</span>
            </button>
          ))}
        </nav>

        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <Boundary key={`${boundaryKey}-${section}`} onReset={() => { setBoundaryKey((k) => k + 1); go("create"); }}>
            <div key={section} className="anim-fade-in h-full">
              <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-muted"><Spinner />{t(T.loading)}</div>}>
                {screen}
              </Suspense>
            </div>
          </Boundary>
        </main>
      </div>

      {/* Bottom navigation (phones) */}
      <nav aria-label={t(["Main navigation", "التنقل الرئيسي"])} className="flex shrink-0 border-t border-line bg-surface md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {NAV.map((n) => (
          <button key={n.id} type="button" onClick={() => navigate(n.id)} aria-current={section === n.id ? "page" : undefined} className={cn("press relative flex min-h-[58px] flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium", section === n.id ? "text-brand" : "text-muted")}>
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
