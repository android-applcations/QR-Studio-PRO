import jsQR from "jsqr";
import { loadImage } from "./raster";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(src: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (o?: { formats?: string[] }) => BarcodeDetectorLike;

let nativeDetector: BarcodeDetectorLike | null | undefined;

/** BarcodeDetector is an optional enhancement only; jsQR is always the baseline. */
function getNative(): BarcodeDetectorLike | null {
  if (nativeDetector !== undefined) return nativeDetector;
  try {
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    nativeDetector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
  } catch {
    nativeDetector = null;
  }
  return nativeDetector;
}

/** Decode possibly several QR codes in an image by masking each found code and retrying. */
export function decodeImageData(img: ImageData, attemptInvert = true): string[] {
  const found: string[] = [];
  const data = new Uint8ClampedArray(img.data); // working copy we may paint over
  for (let i = 0; i < 6; i++) {
    const res = jsQR(data, img.width, img.height, { inversionAttempts: attemptInvert ? "attemptBoth" : "dontInvert" });
    if (!res) break;
    if (!found.includes(res.data)) found.push(res.data);
    const { topLeftCorner: a, topRightCorner: b, bottomRightCorner: c, bottomLeftCorner: d } = res.location;
    const xs = [a.x, b.x, c.x, d.x];
    const ys = [a.y, b.y, c.y, d.y];
    const pad = 4;
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad);
    const x1 = Math.min(img.width - 1, Math.ceil(Math.max(...xs)) + pad);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
    const y1 = Math.min(img.height - 1, Math.ceil(Math.max(...ys)) + pad);
    for (let y = y0; y <= y1; y++) {
      const row = y * img.width * 4;
      for (let x = x0; x <= x1; x++) {
        const o = row + x * 4;
        data[o] = data[o + 1] = data[o + 2] = 128;
        data[o + 3] = 255;
      }
    }
  }
  return found;
}

/** Decode overlapping tiles (halves / quadrants) so several side-by-side codes can be separated. */
export function decodeTiled(canvas: HTMLCanvasElement, grids: [number, number][] = [[2, 1], [1, 2], [2, 2]]): string[] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  let found: string[] = [];
  for (const [gx, gy] of grids) {
    const tw = Math.round(canvas.width / gx);
    const th = Math.round(canvas.height / gy);
    const ox = gx > 1 ? Math.round(tw * 0.1) : 0;
    const oy = gy > 1 ? Math.round(th * 0.1) : 0;
    for (let iy = 0; iy < gy; iy++) {
      for (let ix = 0; ix < gx; ix++) {
        const x = Math.max(0, ix * tw - ox);
        const y = Math.max(0, iy * th - oy);
        const w = Math.min(canvas.width - x, tw + 2 * ox);
        const h = Math.min(canvas.height - y, th + 2 * oy);
        if (w < 40 || h < 40) continue;
        found = merge(found, decodeImageData(ctx.getImageData(x, y, w, h)));
      }
    }
  }
  return found;
}

function drawScaled(src: CanvasImageSource, sw: number, sh: number, maxSide: number): HTMLCanvasElement {
  const ratio = maxSide / Math.max(sw, sh);
  const w = Math.max(32, Math.round(sw * ratio));
  const h = Math.max(32, Math.round(sh * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("CANVAS_UNSUPPORTED");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

async function nativeDecode(src: CanvasImageSource): Promise<string[]> {
  const n = getNative();
  if (!n) return [];
  try {
    const res = await n.detect(src);
    return res.map((r) => r.rawValue).filter(Boolean);
  } catch {
    nativeDetector = null;
    return [];
  }
}

function merge(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const x of b) if (!out.includes(x)) out.push(x);
  return out;
}

/** Decode an image file using several scales so low-quality / large / small images work. */
export async function decodeImageFile(file: File): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    if (!sw || !sh) return [];
    let found: string[] = [];
    const max = Math.max(sw, sh);
    // Decoders are sensitive to pixels-per-module, so sample the image at many scales and merge results.
    const down = [1600, 1100, 800, 600, 450, 340, 260, 200].filter((s) => s <= max);
    const up = max < 500 ? [max * 2, max * 3].map((s) => Math.min(1200, Math.round(s))) : [];
    const scales = Array.from(new Set([...(max <= 1600 ? [max] : []), ...down, ...up]));
    for (const s of scales) {
      const canvas = drawScaled(img, sw, sh, s);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) continue;
      found = merge(found, decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height)));
      if (s === 800 || s === 450 || (scales.length < 3 && s === scales[0])) found = merge(found, decodeTiled(canvas));
    }
    found = merge(found, await nativeDecode(img));
    return found;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Live camera ----------

export type CameraErrorKind = "denied" | "none" | "busy" | "insecure" | "unsupported" | "unknown";

/** True when the browser exposes getUserMedia in a secure context (HTTPS or localhost). */
export function cameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    (typeof window === "undefined" || window.isSecureContext !== false)
  );
}

export function cameraErrorKind(e: unknown): CameraErrorKind {
  const name = (e as { name?: string })?.name;
  if ((e as Error)?.message === "UNSUPPORTED") return "unsupported";
  if ((e as Error)?.message === "INSECURE") return "insecure";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "none";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  return "unknown";
}

export interface CameraCaps {
  torch: boolean;
  zoom: { min: number; max: number; step: number } | null;
}

type ExtCaps = MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number; step: number } };

export class CameraSession {
  stream: MediaStream | null = null;
  private tick = 0;
  private running = false;
  private frame = 0;
  private video: HTMLVideoElement | null = null;
  private onTrackEnded: (() => void) | null = null;

  static async listCameras(): Promise<MediaDeviceInfo[]> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === "videoinput");
    } catch {
      return [];
    }
  }

  async start(video: HTMLVideoElement, opts: { deviceId?: string; facing?: "environment" | "user" }): Promise<CameraCaps> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(window.isSecureContext === false ? "INSECURE" : "UNSUPPORTED");
    }
    this.stop();
    this.video = video;
    const base: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const video_: MediaTrackConstraints = opts.deviceId
      ? { ...base, deviceId: { exact: opts.deviceId } }
      : { ...base, facingMode: { ideal: opts.facing ?? "environment" } };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
    } catch (e) {
      if ((e as { name?: string }).name === "OverconstrainedError" || (e as { name?: string }).name === "NotFoundError") {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else throw e;
    }
    video.srcObject = this.stream;
    video.muted = true;
    video.setAttribute("playsinline", "true");
    await video.play();
    // If the device loses the camera (unplugged, taken by another app) stop decoding.
    const track = this.stream.getVideoTracks()[0];
    if (track) {
      this.onTrackEnded = () => this.pauseLoop();
      track.addEventListener("ended", this.onTrackEnded);
    }
    return this.capabilities();
  }

  capabilities(): CameraCaps {
    const track = this.stream?.getVideoTracks()[0];
    let caps: ExtCaps = {};
    try {
      caps = (track?.getCapabilities?.() ?? {}) as ExtCaps;
    } catch {
      /* unsupported */
    }
    return { torch: !!caps.torch, zoom: caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 } : null };
  }

  currentDeviceId(): string | null {
    return this.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? null;
  }

  async setTorch(on: boolean): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
  }

  async setZoom(z: number): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    await track.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] });
  }

  /** Start the decode loop (~10 fps). */
  loop(video: HTMLVideoElement, onFound: (codes: string[]) => void): void {
    this.running = true;
    let busy = false;
    let last = 0;
    const step = async (ts: number) => {
      if (!this.running) return;
      this.tick = requestAnimationFrame(step);
      if (busy || ts - last < 90 || video.readyState < 2 || !video.videoWidth) return;
      last = ts;
      busy = true;
      try {
        // alternate scales: decoders are sensitive to pixels-per-module
        const canvas = drawScaled(video, video.videoWidth, video.videoHeight, this.frame % 2 === 0 ? 720 : 480);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        let codes: string[] = [];
        if (getNative()) codes = await nativeDecode(canvas);
        this.frame++;
        if (!codes.length && ctx && (!getNative() || this.frame % 4 === 0)) {
          codes = decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), this.frame % 2 === 0);
        }
        if (!codes.length && ctx && this.frame % 6 === 0) codes = decodeTiled(canvas, [[2, 1], [1, 2]]);
        if (codes.length && this.running) onFound(codes);
      } catch {
        /* ignore frame errors */
      } finally {
        busy = false;
      }
    };
    this.tick = requestAnimationFrame(step);
  }

  pauseLoop(): void {
    this.running = false;
    cancelAnimationFrame(this.tick);
  }

  /** Releases the MediaStream completely: stops every track and detaches the video. */
  stop(): void {
    this.pauseLoop();
    const track = this.stream?.getVideoTracks()[0];
    if (track && this.onTrackEnded) {
      track.removeEventListener("ended", this.onTrackEnded);
      this.onTrackEnded = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      try {
        this.video.srcObject = null;
      } catch {
        /* some browsers throw on a detached element */
      }
      this.video = null;
    }
  }
}
