import type { DesignConfig } from "../core/types";
import { renderQrSvg } from "./designEngine";
import { MAX_CANVAS } from "./raster";
import { buildPdf, mmToPt, PAPER, type PdfPage } from "./pdf";
import { rasterizeBlob } from "./renderClient";

export type ExportFormat = "png" | "jpg" | "svg" | "pdf";
export type PaperKey = "a4" | "a5" | "letter" | "fit";

export interface ExportOptions {
  format: ExportFormat;
  /** Width in px of the output image */
  size: number;
  transparent: boolean;
  quality: number;
  includeFrame: boolean;
  includeLogo: boolean;
  filename: string;
  paper: PaperKey;
  /** Printed size in mm (PDF) */
  printMm: number;
}

export const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

export const supportsTransparency = (f: ExportFormat) => f === "png" || f === "svg";

export function sanitizeFilename(name: string, fallback = "qr-code"): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

export function timestampName(prefix: string): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${sanitizeFilename(prefix, "qr")}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const clampSize = (n: number) => Math.max(128, Math.min(MAX_CANVAS, Math.round(n)));

export async function renderToBlob(
  content: string,
  design: DesignConfig,
  logoHref: string | null,
  opts: ExportOptions,
): Promise<Blob> {
  const transparent = supportsTransparency(opts.format) && opts.transparent;
  const r = renderQrSvg(content, design, {
    logoHref: opts.includeLogo ? logoHref : null,
    frame: opts.includeFrame,
    transparent,
  });
  if (opts.format === "svg") return new Blob([r.svg], { type: MIME.svg });

  if (opts.format === "pdf") {
    const mm = Math.max(10, Math.min(opts.paper === "fit" ? 400 : 190, opts.printMm));
    const px = clampSize(Math.max(1000, (mm / 25.4) * 300));
    const page = await buildPdfPage([{ svg: r.svg, ratio: r.height / r.width }], mm, opts.paper, 0, px);
    return buildPdf([page]);
  }
  const w = clampSize(opts.size);
  const h = (w * r.height) / r.width;
  return rasterizeBlob(r.svg, Math.round(w), Math.round(h), transparent ? null : "#ffffff", MIME[opts.format], opts.format === "jpg" ? opts.quality : undefined);
}

async function jpegBytes(svg: string, px: number, ratio: number): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const h = Math.round(px * ratio);
  // Off the UI thread where the worker can do it: a PDF page is rendered at
  // 300 dpi, which is a lot of pixels to paint while the button is still down.
  const blob = await rasterizeBlob(svg, px, h, "#ffffff", "image/jpeg", 0.97);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: px, h };
}

/** Build one PDF page with a single centered QR. */
async function buildPdfPage(
  items: { svg: string; ratio: number }[],
  mm: number,
  paper: PaperKey,
  margin: number,
  px: number,
): Promise<PdfPage> {
  const it = items[0];
  const wPt = mmToPt(mm);
  const hPt = wPt * it.ratio;
  const pg = paper === "fit" ? { w: wPt + 2 * margin, h: hPt + 2 * margin } : PAPER[paper];
  const img = await jpegBytes(it.svg, px, it.ratio);
  return {
    w: pg.w,
    h: pg.h,
    images: [{ jpeg: img.bytes, pxW: img.w, pxH: img.h, x: (pg.w - wPt) / 2, y: (pg.h - hPt) / 2, w: wPt, h: hPt }],
  };
}

// ---------- Delivery ----------

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}

type PickerWindow = Window & {
  showSaveFilePicker?: (o: {
    suggestedName: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
};

export const canPickLocation = () => typeof (window as PickerWindow).showSaveFilePicker === "function";

/** Save to a user-chosen folder using File System Access API. Returns false if cancelled. */
export async function saveToLocation(blob: Blob, filename: string): Promise<boolean> {
  const w = window as PickerWindow;
  if (!w.showSaveFilePicker) throw new Error("PICKER_UNSUPPORTED");
  const ext = filename.split(".").pop() ?? "";
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: ext.toUpperCase(), accept: { [blob.type || "application/octet-stream"]: ["." + ext] } }],
    });
    const stream = await handle.createWritable();
    await stream.write(blob);
    await stream.close();
    return true;
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return false;
    throw e;
  }
}

export function canShareFile(blob: Blob, filename: string): boolean {
  try {
    if (!("share" in navigator) || !("canShare" in navigator)) return false;
    const file = new File([blob], filename, { type: blob.type });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export const canShareText = () => typeof navigator !== "undefined" && "share" in navigator;

export async function shareFile(blob: Blob, filename: string, title: string): Promise<boolean> {
  const file = new File([blob], filename, { type: blob.type });
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return false;
    throw e;
  }
}

export async function shareText(text: string, title: string): Promise<boolean> {
  try {
    await navigator.share({ text, title });
    return true;
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return false;
    throw e;
  }
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* fall through to legacy */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("COPY_FAILED");
}

export const canCopyImage = () => typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;

export async function copyImage(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
