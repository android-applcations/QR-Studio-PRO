import jsQR from "jsqr";
import type { DesignConfig } from "../core/types";
import { renderQrSvg } from "./designEngine";
import { rasterizeBlob } from "./renderClient";

export interface VerifyResult {
  ok: boolean;
  decoded: string | null;
}

/** Pixels per module that mimic realistic camera captures (decoders are scale sensitive). */
const SCALES = [5, 6, 4];

/**
 * Pixels of a finished image, however this browser will give them to us.
 *
 * `createImageBitmap` decodes off the main thread, which is the point: the
 * expensive part of the check (painting the design at scanner resolution) has
 * already happened in the worker by the time we get here, and decoding the
 * result must not undo that by blocking on the UI thread.
 */
async function toPixels(blob: Blob, w: number, h: number): Promise<Uint8ClampedArray | null> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(blob);
    try {
      const canvas: OffscreenCanvas | HTMLCanvasElement =
        typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
      const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | null;
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    } finally {
      bmp.close?.();
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("IMAGE_DECODE"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Actually decode the rendered design with a real QR decoder (jsQR).
 * Transparent backgrounds are composited over white (worst typical case).
 * The code is sampled at several realistic scales; one successful, exact decode verifies it.
 *
 * Runs while the user is still editing, so the rendering and the painting are
 * done in the render worker whenever the browser allows it — only the decode
 * itself stays here, and it reads pixels rather than producing them.
 */
/**
 * One answer to the same question.
 *
 * Two parts of the editor ask "can a scanner read this?" while the same design
 * is on screen. Decoding is the most expensive thing on the screen, so the last
 * question is remembered: identical inputs share one answer instead of paying
 * for the same pixels twice.
 */
let last: { key: string; promise: Promise<VerifyResult> } | null = null;

export function verifyDesign(content: string, design: DesignConfig, logoHref: string | null): Promise<VerifyResult> {
  const key = `${content}\u0000${JSON.stringify(design)}\u0000${logoHref ?? ""}`;
  if (last?.key === key) return last.promise;
  const promise = runVerify(content, design, logoHref).catch((e) => {
    if (last?.promise === promise) last = null;
    throw e;
  });
  last = { key, promise };
  return promise;
}

async function runVerify(content: string, design: DesignConfig, logoHref: string | null): Promise<VerifyResult> {
  const r = renderQrSvg(content, design, { logoHref, frame: false, transparent: false });
  for (const ppm of SCALES) {
    const px = Math.max(120, Math.round(r.modules * ppm));
    let data: Uint8ClampedArray | null = null;
    try {
      const blob = await rasterizeBlob(r.svg, px, px, "#ffffff", "image/png");
      data = await toPixels(blob, px, px);
    } catch {
      continue;
    }
    if (!data) continue;
    const res = jsQR(data, px, px, { inversionAttempts: "dontInvert" });
    if (res && res.data === content) return { ok: true, decoded: res.data };
  }
  return { ok: false, decoded: null };
}
