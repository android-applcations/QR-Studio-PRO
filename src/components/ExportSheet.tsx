import { useEffect, useMemo, useState } from "react";
import { Clipboard, Download, FolderDown, Printer, Share2 } from "lucide-react";
import type { DesignConfig } from "../core/types";
import { T } from "../core/i18n";
import { useApp } from "../state/AppContext";
import {
  canCopyImage, canPickLocation, canShareFile, copyImage, downloadBlob, renderToBlob, sanitizeFilename, saveToLocation,
  shareFile, supportsTransparency, timestampName, MIME, type ExportFormat, type ExportOptions, type PaperKey,
} from "../engine/exportEngine";
import { buildZip, type GeneratedItem } from "../engine/batch";
import { renderQrSvg } from "../engine/designEngine";
import { Button, Field, inputCls, Modal, Notice, Segmented, Slider, Toggle } from "./ui";
import { QrImage, ReadabilityPanel, useReadability } from "./QrView";

export interface ExportItem {
  content: string;
  design: DesignConfig;
  logoHref: string | null;
  name: string;
  type: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  items: ExportItem[];
  onPrint?: () => void;
}

const SIZES = [512, 1024, 2048, 4096];

export function ExportSheet({ open, onClose, items, onPrint }: Props) {
  const { t, toast, fail, confirm, logActivity } = useApp();
  const first = items[0];
  const multi = items.length > 1;
  const [format, setFormat] = useState<ExportFormat>("png");
  const [size, setSize] = useState(1024);
  const [transparent, setTransparent] = useState(false);
  const [quality, setQuality] = useState(92);
  const [includeFrame, setIncludeFrame] = useState(true);
  const [includeLogo, setIncludeLogo] = useState(true);
  const [filename, setFilename] = useState("");
  const [paper, setPaper] = useState<PaperKey>("a4");
  const [printMm, setPrintMm] = useState(60);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (!open || !first) return;
    setFilename(multi ? timestampName("qr-codes") : sanitizeFilename(first.name, timestampName("qr")));
    setSize(first.design.size >= 128 ? first.design.size : 1024);
    setTransparent(first.design.bgTransparent);
    setFormat("png");
  }, [open, first, multi]);

  const rd = useReadability(first?.content ?? "", first?.design ?? ({} as DesignConfig), first?.logoHref ?? null);
  const hasFrame = !!first && first.design.frameStyle !== "none" && first.design.frameText.trim().length > 0;
  const hasLogo = !!first?.logoHref;
  const canTransparent = supportsTransparency(format);

  const dims = useMemo(() => {
    if (!first || !first.content) return null;
    try {
      const r = renderQrSvg(first.content, first.design, { logoHref: includeLogo ? first.logoHref : null, frame: includeFrame });
      return { w: size, h: Math.round((size * r.height) / r.width) };
    } catch {
      return null;
    }
  }, [first, size, includeFrame, includeLogo]);

  if (!first) return null;
  const ext = multi ? "zip" : format;
  const fullName = `${sanitizeFilename(filename, "qr-code")}.${ext}`;

  const opts = (): ExportOptions => ({
    format, size, transparent: transparent && canTransparent, quality: quality / 100, includeFrame, includeLogo, filename, paper, printMm,
  });

  const makeBlob = async (): Promise<Blob> => {
    if (!multi) return renderToBlob(first.content, first.design, first.logoHref, opts());
    const gen: GeneratedItem[] = items.map((it) => {
      const r = renderQrSvg(it.content, it.design, { logoHref: includeLogo ? it.logoHref : null, frame: includeFrame });
      return { name: it.name, content: it.content, svg: r.svg, width: r.width, height: r.height };
    });
    return buildZip(gen, format === "pdf" ? "png" : format, size, (d, n) => setProgress(`${d}/${n}`));
  };

  const guard = async (): Promise<boolean> => {
    if (!rd.risky || multi) return true;
    return confirm({
      title: ["This code may not scan", "قد لا يُقرأ هذا الرمز"],
      message: ["A test scanner could not confirm this design, or serious readability problems were detected. Export anyway?", "لم يتمكن ماسح الاختبار من تأكيد هذا التصميم أو تم رصد مشاكل خطيرة في القراءة. هل تريد التصدير رغم ذلك؟"],
      confirmLabel: ["Export anyway", "تصدير رغم ذلك"],
      danger: true,
    });
  };

  const run = async (action: "download" | "folder" | "share" | "copy") => {
    if (!(await guard())) return;
    setBusy(true);
    setProgress("");
    try {
      if (action === "copy") {
        const png = await renderToBlob(first.content, first.design, first.logoHref, { ...opts(), format: "png" });
        await copyImage(png);
        toast(t(T.copied));
        return;
      }
      const blob = await makeBlob();
      if (action === "share") {
        if (canShareFile(blob, fullName)) {
          if (!(await shareFile(blob, fullName, first.name))) return;
        } else {
          downloadBlob(blob, fullName);
          toast(["Sharing files isn't supported here — the file was downloaded instead", "مشاركة الملفات غير مدعومة هنا — تم تنزيل الملف بدلاً من ذلك"], "info");
        }
      } else if (action === "folder") {
        if (!(await saveToLocation(blob, fullName))) return;
      } else {
        downloadBlob(blob, fullName);
      }
      logActivity({ action: "export", type: first.type, content: first.content, name: first.name });
      toast([`Exported ${fullName}`, `تم تصدير ${fullName}`]);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const fmts: { value: ExportFormat; label: string }[] = [
    { value: "png", label: "PNG" },
    { value: "jpg", label: "JPG" },
    { value: "svg", label: "SVG" },
    ...(multi ? [] : [{ value: "pdf" as ExportFormat, label: "PDF" }]),
  ];

  return (
    <Modal open={open} onClose={onClose} title={t(T.export)} wide>
      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-44 max-w-full rounded-2xl border border-line bg-white p-2 md:w-full">
            <QrImage content={first.content} design={first.design} logoHref={first.logoHref} className="w-full" />
          </div>
          {multi && <p className="text-center text-xs text-muted">{t([`${items.length} codes will be packed in one ZIP file`, `سيتم تجميع ${items.length} رمزاً في ملف ZIP واحد`])}</p>}
          {!multi && <div className="w-full"><ReadabilityPanel status={rd.status} issues={rd.issues} compact /></div>}
        </div>

        <div className="space-y-4">
          <Field label={t(["Format", "الصيغة"])}>
            <Segmented value={format} onChange={setFormat} options={fmts} label="Format" />
          </Field>

          {format !== "svg" && format !== "pdf" && (
            <Field label={t(["Resolution (px)", "الدقة (بكسل)"])} hint={dims ? `${dims.w} × ${dims.h} px` : undefined}>
              <div className="flex flex-wrap gap-2">
                {SIZES.map((s) => (
                  <button key={s} type="button" onClick={() => setSize(s)} className={`press min-h-10 rounded-lg border px-3 text-[13px] ${size === s ? "border-brand bg-brand/15 text-brand" : "border-line bg-surface2 text-muted"}`}>
                    {s}
                  </button>
                ))}
                <input type="number" inputMode="numeric" min={128} max={4096} value={size} aria-label={t(["Custom size", "حجم مخصص"])} onChange={(e) => setSize(Math.max(128, Math.min(4096, Number(e.target.value) || 128)))} className={`${inputCls()} !w-24 !min-h-10`} dir="ltr" />
              </div>
            </Field>
          )}

          {format === "pdf" && !multi && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t(["Paper", "الورق"])}>
                <select className={inputCls()} value={paper} onChange={(e) => setPaper(e.target.value as PaperKey)}>
                  <option value="a4">A4</option>
                  <option value="a5">A5</option>
                  <option value="letter">Letter</option>
                  <option value="fit">{t(["Fit to code", "على قدر الرمز"])}</option>
                </select>
              </Field>
              <Field label={t(["Printed size (mm)", "حجم الطباعة (مم)"])}>
                <input type="number" className={inputCls()} min={10} max={paper === "fit" ? 400 : 190} value={printMm} onChange={(e) => setPrintMm(Math.max(10, Number(e.target.value) || 10))} dir="ltr" />
              </Field>
            </div>
          )}

          {format === "jpg" && <Slider label={t(["JPG quality", "جودة JPG"])} value={quality} min={50} max={100} onChange={setQuality} suffix="%" />}

          <div className="rounded-2xl border border-line bg-surface2/50 px-3 py-1">
            <Toggle
              checked={transparent && canTransparent}
              onChange={setTransparent}
              label={t(["Transparent background", "خلفية شفافة"])}
              desc={canTransparent ? undefined : t(["Not available for JPG and PDF", "غير متاح لصيغتي JPG وPDF"])}
            />
            {hasFrame && <Toggle checked={includeFrame} onChange={setIncludeFrame} label={t(["Include frame & caption", "تضمين الإطار والعبارة"])} />}
            {hasLogo && <Toggle checked={includeLogo} onChange={setIncludeLogo} label={t(["Include logo", "تضمين الشعار"])} />}
          </div>
          {transparent && canTransparent && <Notice level="warn">{t(["Transparent codes may be unreadable on dark or busy backgrounds.", "قد لا تُقرأ الرموز الشفافة على الخلفيات الداكنة أو المزدحمة."])}</Notice>}

          <Field label={t(["File name", "اسم الملف"])} hint={fullName}>
            <input className={inputCls()} value={filename} onChange={(e) => setFilename(e.target.value)} dir="ltr" maxLength={80} />
          </Field>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" disabled={busy} onClick={() => run("download")} icon={<Download size={18} />}>
              {busy ? `${t(T.loading)} ${progress}` : t(T.download)}
            </Button>
            {canPickLocation() && (
              <Button disabled={busy} onClick={() => run("folder")} icon={<FolderDown size={18} />}>{t(["Save to folder…", "حفظ في مجلد…"])}</Button>
            )}
            {"share" in navigator && (
              <Button disabled={busy} onClick={() => run("share")} icon={<Share2 size={18} />}>{t(T.share)}</Button>
            )}
            {!multi && canCopyImage() && (
              <Button disabled={busy} onClick={() => run("copy")} icon={<Clipboard size={18} />}>{t(["Copy image", "نسخ الصورة"])}</Button>
            )}
            {onPrint && (
              <Button disabled={busy} onClick={onPrint} icon={<Printer size={18} />}>{t(T.print)}</Button>
            )}
          </div>
          <p className="text-[11px] text-muted">{MIME[multi ? "png" : format] && t(["Files are saved to your device Downloads folder.", "تُحفظ الملفات في مجلد التنزيلات بجهازك."])}</p>
        </div>
      </div>
    </Modal>
  );
}
