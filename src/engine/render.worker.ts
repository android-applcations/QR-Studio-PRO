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
import { renderQrSvg } from "./designEngine";
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

async function run(job: RenderJob, id: number): Promise<RenderReply> {
  if (job.kind === "raster") {
    const blob = await rasterToBlob(job.svg, job.w, job.h, job.bg, job.mime, job.quality);
    return { id, ok: true, blob };
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
