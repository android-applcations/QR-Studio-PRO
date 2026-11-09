/// <reference lib="webworker" />
/**
 * The heavy half of the app, moved off the UI thread.
 *
 * Building a few hundred QR codes and rasterising them at 1024 px is seconds of
 * solid CPU work. On the UI thread that is seconds in which the progress bar
 * does not move, the cancel button does not respond and the phone gets hot.
 *
 * Everything happening here is plain computation — `designEngine` is pure (it
 * never touches `document`), and rasterising uses `OffscreenCanvas` and
 * `createImageBitmap`, which exist precisely so this can happen in a worker.
 *
 * The client falls back to the main thread whenever any of that is missing, so
 * this is an accelerator, never a requirement.
 */
import JSZip from "jszip";
import { renderQrSvg } from "./designEngine";
import { buildPdf, mmToPt, PAPER, type PdfPage } from "./pdf";
import { sanitizeFilename as sanitize } from "./naming";
import type { RenderItem, RenderJob, RenderReply } from "./renderProtocol";

const post = (m: RenderReply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

/**
 * SVG → pixels without a document.
 *
 * `OffscreenCanvas` is the worker's canvas; `createImageBitmap` is the worker's
 * `new Image()`. Both need the SVG to carry its own width and height, which
 * `renderQrSvg` always writes.
 */
async function rasterToBlob(svg: string, w: number, h: number, bg: string | null, mime: string, quality?: number): Promise<Blob> {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    throw new Error("OFFSCREEN_UNSUPPORTED");
  }
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CANVAS_UNSUPPORTED");
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    return await canvas.convertToBlob(quality != null ? { type: mime, quality } : { type: mime });
  } finally {
    bmp.close?.();
  }
}

/** JPEG bytes for one page, produced here rather than shipped in. */
async function jpegBytes(svg: string, px: number, ratio: number): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const h = Math.round(px * ratio);
  const blob = await rasterToBlob(svg, px, h, "#ffffff", "image/jpeg", 0.97);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: px, h };
}

/**
 * One printed page, built end to end.
 *
 * The code is rendered, painted at 300 dpi and wrapped in a PDF without the
 * main thread ever touching a pixel — which is what makes a print export
 * possible on a phone without the page going still while it happens.
 */
async function buildPdfBlob(job: Extract<RenderJob, { kind: "pdf" }>): Promise<Blob> {
  const mm = Math.max(10, Math.min(job.paper === "fit" ? 400 : 190, job.printMm));
  const px = Math.max(128, Math.min(4096, Math.round(Math.max(1000, (mm / 25.4) * 300))));
  const wPt = mmToPt(mm);
  const hPt = wPt * job.ratio;
  const pg = job.paper === "fit" ? { w: wPt, h: hPt } : PAPER[job.paper];
  const img = await jpegBytes(job.svg, px, job.ratio);
  const page: PdfPage = {
    w: pg.w,
    h: pg.h,
    images: [{ jpeg: img.bytes, pxW: img.w, pxH: img.h, x: (pg.w - wPt) / 2, y: (pg.h - hPt) / 2, w: wPt, h: hPt }],
  };
  return buildPdf([page], job.title ?? "QR Studio Pro");
}

/** A batch archive: rasterise every code, then compress them all. */
async function buildZipBlob(job: Extract<RenderJob, { kind: "zip" }>, id: number): Promise<Blob> {
  const zip = new JSZip();
  const used = new Map<string, number>();
  const manifest = ["file,name,content"];
  for (let i = 0; i < job.items.length; i++) {
    const it = job.items[i];
    const base = sanitize(it.name, `qr-${i + 1}`);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const file = `${n > 1 ? `${base}-${n}` : base}.${job.format}`;
    if (job.format === "svg") {
      zip.file(file, it.svg);
    } else {
      const mime = job.format === "jpg" ? "image/jpeg" : "image/png";
      zip.file(file, await rasterToBlob(it.svg, job.size, Math.round((job.size * it.height) / it.width), "#ffffff", mime, 0.95));
    }
    manifest.push([file, it.name, it.content].map((c) => `"${c.replace(/"/g, '""')}"`).join(","));
    if (i % 10 === 9) post({ id, progress: { done: i + 1, total: job.items.length } });
  }
  zip.file("manifest.csv", "\uFEFF" + manifest.join("\n"));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

async function run(job: RenderJob, id: number): Promise<RenderReply> {
  if (job.kind === "raster") {
    const blob = await rasterToBlob(job.svg, job.w, job.h, job.bg, job.mime, job.quality);
    return { id, ok: true, blob };
  }
  if (job.kind === "pdf") return { id, ok: true, blob: await buildPdfBlob(job) };
  if (job.kind === "zip") return { id, ok: true, archive: await buildZipBlob(job, id) };
  if (job.kind === "sheet") {
    const images: Blob[] = [];
    for (let i = 0; i < job.items.length; i++) {
      const it = job.items[i];
      const out = renderQrSvg(it.content, it.design, { logoHref: it.logoHref, transparent: false });
      images.push(await rasterToBlob(out.svg, job.px, Math.round((job.px * out.height) / out.width), "#ffffff", "image/png"));
      if (i % 5 === 4) post({ id, progress: { done: i + 1, total: job.items.length } });
    }
    return { id, ok: true, images };
  }

  const items: RenderItem[] = [];
  const failedLines: number[] = [];
  for (let i = 0; i < job.rows.length; i++) {
    const r = job.rows[i];
    try {
      const out = renderQrSvg(r.content, job.design, { logoHref: job.logoHref });
      items.push({ name: r.name || `${job.autoName} ${items.length + 1}`, content: r.content, svg: out.svg, width: out.width, height: out.height });
    } catch {
      failedLines.push(r.line);
    }
    // Enough to keep a progress bar honest without flooding the message port.
    if (i % 10 === 9) post({ id, progress: { done: i + 1, total: job.rows.length } });
  }
  return { id, ok: true, items, failedLines };
}

self.addEventListener("message", (e: MessageEvent<RenderJob & { id: number }>) => {
  const { id, ...job } = e.data;
  run(job as RenderJob, id)
    .then(post)
    .catch((err: unknown) => post({ id, ok: false, error: err instanceof Error ? err.message : String(err) }));
});
