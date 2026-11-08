import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Lang, SectionId, ThemeMode, Tx } from "../core/types";
import { pick } from "../core/i18n";
import { addHistory, describeError, putSetting } from "../db/db";
import { redactForLog } from "../core/qrTypes";

export interface Toast {
  id: number;
  kind: "ok" | "err" | "info";
  msg: string;
  action?: { label: string; run: () => void };
}

export interface ConfirmOptions {
  title: Tx;
  message: Tx;
  confirmLabel?: Tx;
  danger?: boolean;
}

interface Ctx {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (l: Lang) => void;
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  saveHistory: boolean;
  setSaveHistory: (v: boolean) => void;
  autoSave: boolean;
  setAutoSave: (v: boolean) => void;
  t: (tx: Tx) => string;
  section: SectionId;
  go: (s: SectionId) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  toast: (msg: Tx | string, kind?: Toast["kind"], action?: Toast["action"]) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  fail: (e: unknown) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  confirmState: (ConfirmOptions & { resolve: (v: boolean) => void }) | null;
  logActivity: (a: { action: "scan" | "create" | "export" | "save"; type: string; content: string; name?: string }) => void;
  /** bumps whenever data changes so lists can refresh */
  dataVersion: number;
  bumpData: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

export const useApp = (): Ctx => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppProvider missing");
  return c;
};

export function AppProvider({ initial, children }: { initial: Record<string, unknown>; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial.lang === "en" ? "en" : initial.lang === "ar" ? "ar" : navigator.language?.startsWith("ar") ? "ar" : "en");
  const [theme, setThemeState] = useState<ThemeMode>(["dark", "light", "system"].includes(initial.theme as string) ? (initial.theme as ThemeMode) : "dark");
  const [saveHistory, setSaveHistoryState] = useState(initial.saveHistory !== false);
  const [autoSave, setAutoSaveState] = useState(initial.autoSave === true);
  const [section, setSection] = useState<SectionId>("create");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<Ctx["confirmState"]>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const toastId = useRef(0);
  const saveHistoryRef = useRef(saveHistory);
  saveHistoryRef.current = saveHistory;

  const persist = useCallback((key: string, value: unknown) => {
    putSetting(key, value).catch(() => {
      /* settings still work for this session */
    });
  }, []);

  const setLang = useCallback((l: Lang) => { setLangState(l); persist("lang", l); }, [persist]);
  const setTheme = useCallback((m: ThemeMode) => { setThemeState(m); persist("theme", m); }, [persist]);
  const setSaveHistory = useCallback((v: boolean) => { setSaveHistoryState(v); persist("saveHistory", v); }, [persist]);
  const setAutoSave = useCallback((v: boolean) => { setAutoSaveState(v); persist("autoSave", v); }, [persist]);

  const dir = lang === "ar" ? "rtl" : "ltr";
  const t = useCallback((tx: Tx) => pick(lang, tx), [lang]);

  // Apply language direction + theme to the document
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    document.title = lang === "ar" ? "QR Studio Pro — إنشاء وتصميم وقراءة رموز QR" : "QR Studio Pro — Create, design & scan QR codes";
  }, [lang, dir]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const eff = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = eff;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", eff === "dark" ? "#090a10" : "#f2f3f8");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const dismissToast = useCallback((id: number) => setToasts((l) => l.filter((x) => x.id !== id)), []);

  const toast = useCallback<Ctx["toast"]>((msg, kind = "ok", action) => {
    const id = ++toastId.current;
    const text = typeof msg === "string" ? msg : pick(lang, msg);
    setToasts((l) => [...l.slice(-2), { id, kind, msg: text, action }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), action ? 7000 : 3200);
  }, [lang]);

  const fail = useCallback((e: unknown) => {
    // central error handling
    console.error(e);
    toast(describeError(e), "err");
  }, [toast]);

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setConfirmState({ ...o, resolve: (v) => { setConfirmState(null); resolve(v); } });
  }), []);

  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);

  const logActivity = useCallback<Ctx["logActivity"]>((a) => {
    if (!saveHistoryRef.current) return;
    addHistory({ action: a.action, type: a.type, content: redactForLog(a.type, a.content), name: a.name, scanned_at: Date.now() })
      .then(bumpData)
      .catch(() => {
        /* activity log is best-effort */
      });
  }, [bumpData]);

  const value = useMemo<Ctx>(() => ({
    lang, dir, setLang, theme, setTheme, saveHistory, setSaveHistory, autoSave, setAutoSave, t,
    section, go: setSection, settingsOpen, setSettingsOpen, toast, toasts, dismissToast, fail, confirm, confirmState,
    logActivity, dataVersion, bumpData,
  }), [lang, dir, setLang, theme, setTheme, saveHistory, setSaveHistory, autoSave, setAutoSave, t, section, settingsOpen, toast, toasts, dismissToast, fail, confirm, confirmState, logActivity, dataVersion, bumpData]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
