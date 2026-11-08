import { memo, useCallback, useEffect, useId, useRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "../utils/cn";
import { useApp } from "../state/AppContext";
import { playSound } from "../core/sound";
import { T } from "../core/i18n";
import type { Tx } from "../core/types";

type Variant = "primary" | "soft" | "ghost" | "danger" | "success";

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  full?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-gradient-to-br from-brand to-[color-mix(in_srgb,var(--c-brand)_70%,#22d3ee)] text-white shadow-[0_6px_18px_-8px_var(--c-brand)] hover:brightness-110",
  soft: "bg-surface2 text-fg border border-line hover:border-brand/50",
  ghost: "text-muted hover:text-fg hover:bg-surface2",
  danger: "bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25",
  success: "bg-[#25d366] text-[#06210f] font-semibold hover:brightness-105",
};

export function Button({ variant = "soft", size = "md", icon, full, className, children, onClick, ...rest }: BtnProps) {
  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      playSound("tap");
      onClick?.(e);
    },
    [onClick],
  );
  return (
    <button
      type="button"
      {...rest}
      onClick={handleClick}
      className={cn(
        "press inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium disabled:pointer-events-none disabled:opacity-45",
        size === "sm" ? "min-h-9 px-3 text-[13px]" : size === "lg" ? "min-h-12 px-5 text-[15px]" : "min-h-11 px-4 text-sm",
        VARIANTS[variant],
        full && "w-full",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * The red "Update" pill.
 *
 * It only ever appears when a new version has actually finished downloading and
 * is waiting to take over — a service worker found an update on the server, not
 * a guess about how long the app has been open. Render it next to whatever
 * opens the update action so the same signal follows the user there.
 */
export function UpdateBadge({ className }: { className?: string }) {
  const { t } = useApp();
  return (
    <span
      dir="rtl"
      className={cn(
        "anim-pop inline-flex select-none items-center rounded-full bg-bad px-1.5 py-[1px] text-[10px] font-extrabold leading-[14px] text-white shadow-[0_2px_10px_-2px_var(--c-bad)]",
        className,
      )}
    >
      {t(T.updateBadge)}
    </span>
  );
}

export function IconBtn({ label, className, children, active, onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      playSound("tap");
      onClick?.(e);
    },
    [onClick],
  );
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      onClick={handleClick}
      className={cn(
        "press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface2 hover:text-fg disabled:pointer-events-none disabled:opacity-40",
        active && "bg-brand/15 text-brand",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  // Move focus into the dialog and restore it on close. This must only run when
  // `open` changes — re-running it on every render would steal focus from inputs
  // inside the dialog while the user is typing.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      prev?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="presentation">
      <div className="anim-fade-in absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={cn("anim-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-2xl outline-none md:rounded-3xl", wide ? "md:max-w-3xl" : "md:max-w-lg")}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 id={id} className="truncate text-base font-semibold">{title}</h2>
          <IconBtn label="Close" onClick={onClose}><X size={20} /></IconBtn>
        </div>
        <div className="scroll-area min-h-0 flex-1 px-4 py-3">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-muted">{label}</label>
      {children}
      {error ? (
        <p role="alert" className="anim-fade-in mt-1 flex items-center gap-1 text-xs text-bad"><AlertTriangle size={12} />{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted/80">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputCls = (invalid?: boolean) =>
  cn(
    "w-full min-h-11 rounded-xl border bg-surface2/70 px-3 text-base text-fg placeholder:text-muted/50 transition-colors focus:border-brand focus:outline-none",
    invalid ? "border-bad/60" : "border-line",
  );

export function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        playSound("toggle");
        onChange(!checked);
      }}
      className="press flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-1 text-start"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {desc && <span className="block text-xs text-muted">{desc}</span>}
      </span>
      <span className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-brand" : "bg-surface2 border border-line")}>
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start]", checked ? "start-[22px]" : "start-0.5")} />
      </span>
    </button>
  );
}

export function Segmented<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: { value: V; label: ReactNode; title?: string }[]; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl border border-line bg-surface2/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => {
            playSound("toggle");
            onChange(o.value);
          }}
          className={cn("press flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-[13px] font-medium", value === o.value ? "bg-brand text-white shadow" : "text-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, suffix = "", id }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; id?: string }) {
  const uid = useId();
  const sid = id ?? uid;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[13px]">
        <label htmlFor={sid} className="font-medium text-muted">{label}</label>
        <span className="tabular-nums text-fg" dir="ltr">{value}{suffix}</span>
      </div>
      <input id={sid} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-8 w-full" />
    </div>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-12 shrink-0" aria-label={label} />
      <label htmlFor={id} className="min-w-0 flex-1 truncate text-[13px] text-muted">{label}</label>
      <span className="text-xs tabular-nums text-muted" dir="ltr">{value.toUpperCase()}</span>
    </div>
  );
}

export const Spinner = ({ size = 18 }: { size?: number }) => (
  <span className="inline-block rounded-full border-2 border-current border-t-transparent" style={{ width: size, height: size, animation: "spin 0.7s linear infinite" }} aria-hidden="true" />
);

export function Empty({ icon, title, desc, action }: { icon: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="anim-fade-up flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-surface2 text-brand">{icon}</div>
      <p className="text-base font-semibold">{title}</p>
      {desc && <p className="max-w-xs text-sm text-muted">{desc}</p>}
      {action}
    </div>
  );
}

export const SectionHead = memo(function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {right}
    </div>
  );
});

export function Notice({ level, children }: { level: "warn" | "error" | "info" | "ok"; children: ReactNode }) {
  const map = {
    warn: ["border-warn/40 bg-warn/10 text-warn", <AlertTriangle key="i" size={16} />],
    error: ["border-bad/40 bg-bad/10 text-bad", <AlertTriangle key="i" size={16} />],
    info: ["border-brand/40 bg-brand/10 text-brand", <Info key="i" size={16} />],
    ok: ["border-ok/40 bg-ok/10 text-ok", <CheckCircle2 key="i" size={16} />],
  } as const;
  return (
    <div role={level === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px] leading-5", map[level][0])}>
      <span className="mt-0.5 shrink-0">{map[level][1]}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ToastHost() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 84px)" }} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cn("anim-pop pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm shadow-xl", t.kind === "err" ? "border-bad/40 bg-[color-mix(in_srgb,var(--c-bad)_18%,var(--c-surface))]" : t.kind === "ok" ? "border-ok/40 bg-[color-mix(in_srgb,var(--c-ok)_16%,var(--c-surface))]" : "border-line bg-surface")}>
          {t.kind === "err" ? <AlertTriangle size={16} className="shrink-0 text-bad" /> : t.kind === "ok" ? <CheckCircle2 size={16} className="shrink-0 text-ok" /> : <Info size={16} className="shrink-0 text-brand" />}
          <span className="min-w-0">{t.msg}</span>
          {t.action && (
            <button type="button" className="press ms-1 shrink-0 rounded-lg px-2 py-1 text-[13px] font-semibold text-brand" onClick={() => { t.action?.run(); dismissToast(t.id); }}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function ConfirmHost() {
  const { confirmState, t } = useApp();
  if (!confirmState) return null;
  const c = confirmState;
  return (
    <Modal
      open
      onClose={() => c.resolve(false)}
      title={t(c.title)}
      footer={
        <>
          <Button variant="ghost" onClick={() => c.resolve(false)}>{t(T.cancel)}</Button>
          <Button variant={c.danger ? "danger" : "primary"} onClick={() => c.resolve(true)}>{t(c.confirmLabel ?? T.confirm)}</Button>
        </>
      }
    >
      <p className="py-1 text-sm leading-6 text-muted">{t(c.message)}</p>
    </Modal>
  );
}

export const txt = (t: (x: Tx) => string, x: Tx | undefined) => (x ? t(x) : "");
