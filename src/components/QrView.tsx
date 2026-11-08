import { memo, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert, Wand2 } from "lucide-react";
import type { DesignConfig } from "../core/types";
import { analyzeDesign, renderQrSvg, svgToDataUrl, type DesignIssue, type RenderResult } from "../engine/designEngine";
import { verifyDesign } from "../engine/verify";
import { useApp } from "../state/AppContext";
import { Button, Spinner } from "./ui";
import { cn } from "../utils/cn";

export function useQrRender(content: string, design: DesignConfig, logoHref: string | null): { result: RenderResult | null; url: string | null; error: boolean } {
  return useMemo(() => {
    if (!content) return { result: null, url: null, error: false };
    try {
      const result = renderQrSvg(content, design, { logoHref });
      return { result, url: svgToDataUrl(result.svg), error: false };
    } catch {
      return { result: null, url: null, error: true };
    }
  }, [content, design, logoHref]);
}

interface QrImageProps {
  content: string;
  design: DesignConfig;
  logoHref: string | null;
  className?: string;
  alt?: string;
}

/** Renders a QR with the full design as an <img> (checkerboard behind transparent backgrounds). */
export const QrImage = memo(function QrImage({ content, design, logoHref, className, alt = "QR code" }: QrImageProps) {
  const { url, error } = useQrRender(content, design, logoHref);
  if (error) {
    return (
      <div className={cn("flex items-center justify-center rounded-xl bg-bad/10 p-3 text-center text-xs text-bad", className)} role="alert">
        <AlertTriangle size={20} />
      </div>
    );
  }
  if (!url) return <div className={cn("skeleton rounded-xl", className)} />;
  return (
    <img
      src={url}
      alt={alt}
      draggable={false}
      className={cn("block h-auto select-none object-contain", className)}
      style={design.bgTransparent ? { backgroundImage: "conic-gradient(#d4d4d8 25%, #fafafa 0 50%, #d4d4d8 0 75%, #fafafa 0)", backgroundSize: "14px 14px" } : undefined}
    />
  );
});

export type VerifyStatus = "idle" | "checking" | "ok" | "fail";

export function useReadability(content: string, design: DesignConfig, logoHref: string | null) {
  const [status, setStatus] = useState<VerifyStatus>("idle");
  const rendered = useMemo(() => {
    if (!content) return null;
    try {
      return renderQrSvg(content, design, { logoHref });
    } catch {
      return null;
    }
  }, [content, design, logoHref]);
  const issues = useMemo<DesignIssue[]>(
    () => (content ? analyzeDesign(design, !!logoHref, rendered?.version, rendered?.logoCoverage) : []),
    [content, design, logoHref, rendered],
  );
  useEffect(() => {
    if (!content || !rendered) {
      setStatus("idle");
      return;
    }
    setStatus("checking");
    let alive = true;
    const id = setTimeout(() => {
      verifyDesign(content, design, logoHref)
        .then((r) => alive && setStatus(r.ok ? "ok" : "fail"))
        .catch(() => alive && setStatus("fail"));
    }, 450);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [content, design, logoHref, rendered]);
  const hasError = issues.some((i) => i.level === "error");
  /** true when a warning should be shown before exporting */
  const risky = status === "fail" || hasError;
  return { status, issues, risky, rendered };
}

export function ReadabilityPanel({ status, issues, onFix, compact }: { status: VerifyStatus; issues: DesignIssue[]; onFix?: (patch: Partial<DesignConfig>) => void; compact?: boolean }) {
  const { t } = useApp();
  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium",
          status === "ok" ? "border-ok/40 bg-ok/10 text-ok" : status === "fail" ? "border-bad/40 bg-bad/10 text-bad" : "border-line bg-surface2 text-muted",
        )}
        role="status"
      >
        {status === "checking" ? <Spinner size={14} /> : status === "ok" ? <CheckCircle2 size={16} /> : status === "fail" ? <ShieldAlert size={16} /> : <Wand2 size={16} />}
        <span className="min-w-0">
          {status === "ok" && t(["Verified: a test scanner decoded this design", "تم التحقق: قرأ ماسح الاختبار هذا التصميم"])}
          {status === "fail" && t(["Not verified: a test scanner could NOT read this design", "لم يتم التحقق: ماسح الاختبار لم يتمكن من قراءة هذا التصميم"])}
          {status === "checking" && t(["Testing readability…", "جارٍ اختبار القراءة…"])}
          {status === "idle" && t(["Enter data to test readability", "أدخل البيانات لاختبار القراءة"])}
        </span>
      </div>
      {!compact && status === "ok" && (
        <p className="px-1 text-[11px] leading-4 text-muted">{t(["This is a software test only. Always test with your phone before printing or publishing.", "هذا اختبار برمجي فقط. جرّب الرمز بهاتفك دائماً قبل الطباعة أو النشر."])}</p>
      )}
      {issues.map((i, k) => (
        <div key={k} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-[12.5px] leading-5", i.level === "error" ? "border-bad/40 bg-bad/10 text-bad" : "border-warn/40 bg-warn/10 text-warn")}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{t(i.text)}</span>
          {i.fix && onFix && (
            <Button size="sm" variant="soft" className="!min-h-8 shrink-0" onClick={() => onFix(i.fix as Partial<DesignConfig>)}>
              {t(["Fix", "إصلاح"])}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
