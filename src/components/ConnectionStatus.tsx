import { useEffect, useState } from "react";
import { Download, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import type { Tx } from "../core/types";
import { useApp } from "../state/AppContext";
import { usePwa, type ConnectionState } from "../pwa/PwaProvider";
import { cn } from "../utils/cn";
import { Spinner } from "./ui";

const LABEL: Record<ConnectionState, Tx> = {
  online: ["Online", "متصل"],
  offline: ["Offline", "غير متصل"],
  "offline-ready": ["Offline ready", "جاهز دون إنترنت"],
  "update-available": ["Update available", "يتوفر تحديث"],
};

const HINT: Record<ConnectionState, Tx> = {
  online: ["Connected. Everything works and your data stays on this device.", "متصل. كل شيء يعمل وتبقى بياناتك على هذا الجهاز."],
  offline: ["No connection. Your codes, designs and scans still work offline.", "لا يوجد اتصال. رموزك وتصاميمك وعمليات المسح تعمل دون إنترنت."],
  "offline-ready": ["The app is installed for offline use. Your data is stored on this device.", "التطبيق جاهز للعمل دون إنترنت. بياناتك مخزّنة على هذا الجهاز."],
  "update-available": ["A new version is downloaded and ready. Updating never deletes your data.", "إصدار جديد جاهز للتثبيت. التحديث لا يحذف بياناتك أبداً."],
};

export function connectionIcon(state: ConnectionState, size = 13) {
  switch (state) {
    case "offline":
      return <WifiOff size={size} />;
    case "offline-ready":
      return <ShieldCheck size={size} />;
    case "update-available":
      return <Download size={size} />;
    default:
      return <Wifi size={size} />;
  }
}

/**
 * Small, always-available connection chip.
 *
 * States: Online · Offline · Offline ready · Update available (bilingual AR/EN).
 * `navigator.onLine` is only the initial indicator — the real state comes from a
 * probe request that the service worker deliberately does not answer from cache,
 * so captive portals and dead connections are detected too.
 */
export default function ConnectionStatus({ className, autoHideReadyMs = 12000 }: { className?: string; autoHideReadyMs?: number }) {
  const { t, confirm } = useApp();
  const { state, updateNow, hideOfflineReady, swSupported } = usePwa();
  const [busy, setBusy] = useState(false);

  // The "offline ready" confirmation is transient: it should not sit in the bar forever.
  useEffect(() => {
    if (state !== "offline-ready" || autoHideReadyMs <= 0) return;
    const id = setTimeout(hideOfflineReady, autoHideReadyMs);
    return () => clearTimeout(id);
  }, [state, autoHideReadyMs, hideOfflineReady]);

  if (!swSupported && state === "online") return null;

  const label = t(LABEL[state]);
  const hint = t(HINT[state]);
  const isUpdate = state === "update-available";

  const onUpdate = async () => {
    const ok = await confirm({
      title: ["Update the app?", "تحديث التطبيق؟"],
      message: [
        "The app will reload to apply the new version. Your saved codes, designs and history stay on this device.",
        "سيتم إعادة تحميل التطبيق لتطبيق الإصدار الجديد. تبقى رموزك وتصاميمك وسجلك على هذا الجهاز.",
      ],
      confirmLabel: ["Update now", "تحديث الآن"],
    });
    if (!ok) return;
    setBusy(true);
    try {
      await updateNow();
    } finally {
      // The page reloads on success; if it did not, allow another attempt.
      setTimeout(() => setBusy(false), 4000);
    }
  };

  if (isUpdate) {
    return (
      <button
        type="button"
        onClick={() => void onUpdate()}
        disabled={busy}
        title={hint}
        aria-label={`${t(LABEL["update-available"])} — ${hint}`}
        className={cn(
          "press flex min-h-9 items-center gap-1.5 rounded-full border border-brand/50 bg-brand/15 px-3 text-[12px] font-semibold text-brand disabled:opacity-60",
          className,
        )}
      >
        {busy ? <Spinner size={13} /> : connectionIcon(state)}
        <span>{t(["Update now", "تحديث الآن"])}</span>
      </button>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      title={hint}
      className={cn(
        "flex min-h-9 select-none items-center gap-1.5 rounded-full border px-3 text-[12px]",
        state === "offline"
          ? "border-warn/40 bg-warn/10 text-warn"
          : state === "offline-ready"
            ? "border-ok/40 bg-ok/10 text-ok"
            : "border-line bg-surface2/60 text-muted",
        className,
      )}
    >
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          state === "offline" ? "bg-warn" : state === "offline-ready" ? "bg-ok" : "bg-ok/70",
        )}
        aria-hidden="true"
      />
      {connectionIcon(state)}
      <span className="whitespace-nowrap">{label}</span>
    </div>
  );
}
