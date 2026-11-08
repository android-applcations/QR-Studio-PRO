import jsQR from "jsqr";
import type { DesignConfig } from "../core/types";
import { renderQrSvg } from "./designEngine";
import { rasterize } from "./raster";

export interface VerifyResult {
  ok: boolean;
  decoded: string | null;
}

/** Pixels per module that mimic realistic camera captures (decoders are scale sensitive). */
const SCALES = [5, 6, 4];

/**
 * Actually decode the rendered design with a real QR decoder (jsQR).
 * Transparent backgrounds are composited over white (worst typical case).
 * The code is sampled at several realistic scales; one successful, exact decode verifies it.
 */
export async function verifyDesign(content: string, design: DesignConfig, logoHref: string | null): Promise<VerifyResult> {
  const r = renderQrSvg(content, design, { logoHref, frame: false, transparent: false });
  for (const ppm of SCALES) {
    const px = Math.max(120, Math.round(r.modules * ppm));
    const canvas = await rasterize(r.svg, px, px, "#ffffff");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { ok: false, decoded: null };
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const res = jsQR(data.data, data.width, data.height, { inversionAttempts: "dontInvert" });
    if (res && res.data === content) return { ok: true, decoded: res.data };
  }
  return { ok: false, decoded: null };
}
