import type { DesignConfig } from "../core/types";
import type { RenderItem, RenderJob, RenderProgress, RenderReply } from "./renderProtocol";

/**
 * A small request/response bridge to `render.worker`.
 *
 * Every function here resolves to `null` when the work cannot be done off the
 * UI thread — no worker, no `OffscreenCanvas`, or a worker that died. Callers
 * then do exactly what they did before, on the main thread. That is the whole
 * design: the worker is a speed-up the app takes when it is available, not a
 * dependency it breaks without.
 */

let worker: Worker | null = null;
/** Set once the worker has proven unusable, so we stop trying. */
let broken = false;
let seq = 0;

type Settled = Exclude<RenderReply, RenderProgress>;

interface Pending {
  resolve: (r: Settled) => void;
  reject: (e: unknown) => void;
  onProgress?: (done: number, total: number) => void;
}

const pending = new Map<number, Pending>();

function killPending(e: unknown): void {
  for (const p of pending.values()) p.reject(e);
  pending.clear();
}

function getWorker(): Worker | null {
  if (broken) return null;
  if (worker) return worker;
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    broken = true;
    return null;
  }
  try {
    worker = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
  } catch {
    broken = true;
    return null;
  }
  worker.addEventListener("message", (e: MessageEvent<RenderReply>) => {
    const data = e.data;
    if (data == null || typeof data !== "object") return;
    const p = pending.get(data.id);
    if (!p) return;
    if ("progress" in data && data.progress) {
      p.onProgress?.(data.progress.done, data.progress.total);
      return;
    }
    pending.delete(data.id);
    p.resolve(data as Settled);
  });
  // A worker that dies mid-job must not leave the UI waiting forever: drop it
  // and let the caller's fallback run.
  worker.addEventListener("error", () => {
    broken = true;
    killPending(new Error("WORKER_ERROR"));
    worker?.terminate();
    worker = null;
  });
  worker.addEventListener("messageerror", () => {
    killPending(new Error("WORKER_MESSAGE_ERROR"));
  });
  return worker;
}

async function call<R>(job: RenderJob, unpack: (ok: Extract<RenderReply, { ok: true }>) => R, onProgress?: (done: number, total: number) => void): Promise<R | null> {
  const w = getWorker();
  if (!w) return null;
  const id = ++seq;
  try {
    const reply = await new Promise<Settled>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("WORKER_TIMEOUT"));
      }, 120000);
      pending.set(id, {
        onProgress,
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
      });
      w.postMessage({ ...job, id });
    });
    if ("progress" in reply && reply.progress) return null;
    if (!reply.ok) throw new Error(reply.error);
    return unpack(reply);
  } catch {
    // Whatever went wrong here is recoverable on the main thread.
    broken = true;
    return null;
  }
}

/** Rasterise an SVG off the UI thread. `null` when that is not possible. */
export function rasterizeOffThread(
  svg: string,
  w: number,
  h: number,
  bg: string | null,
  mime: string,
  quality?: number,
): Promise<Blob | null> {
  return call({ kind: "raster", svg, w, h, bg, mime, quality }, (ok) => ok.blob ?? null);
}

/** Render a whole batch off the UI thread. `null` when that is not possible. */
export function generateOffThread(
  rows: { line: number; name: string; content: string }[],
  design: DesignConfig,
  logoHref: string | null,
  autoName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ items: RenderItem[]; failedLines: number[] } | null> {
  return call(
    { kind: "generate", rows, design, logoHref, autoName },
    (ok) => ({ items: ok.items ?? [], failedLines: ok.failedLines ?? [] }),
    onProgress,
  );
}

/** Whether the off-thread path is live — used by the tests and nothing else. */
export function workerStatus(): "live" | "unavailable" | "not-started" {
  if (broken) return "unavailable";
  return worker ? "live" : "not-started";
}
