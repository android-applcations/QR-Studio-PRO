import type { DesignConfig } from "../core/types";

/**
 * The messages exchanged with the render worker.
 *
 * This file holds types only, on purpose: both the worker and the client import
 * it, and importing anything with runtime code from the worker would pull the
 * worker's bundle into the main one.
 */

export interface GenerateJob {
  kind: "generate";
  /** one entry per row that passed validation */
  rows: { line: number; name: string; content: string }[];
  design: DesignConfig;
  logoHref: string | null;
  autoName: string;
}

export interface RasterJob {
  kind: "raster";
  svg: string;
  w: number;
  h: number;
  /** null keeps the background transparent */
  bg: string | null;
  mime: string;
  quality?: number;
}

export type RenderJob = GenerateJob | RasterJob;

export interface RenderItem {
  name: string;
  content: string;
  svg: string;
  width: number;
  height: number;
}

export interface RenderOk {
  /** for `generate`: one item per successful row, in order */
  items?: RenderItem[];
  /** for `generate`: the line numbers that could not be rendered */
  failedLines?: number[];
  /** for `raster` */
  blob?: Blob;
}

export interface RenderErr {
  error: string;
}

export interface RenderProgress {
  progress: { done: number; total: number };
}

/** Every reply carries `id`; the shape of the rest depends on what happened. */
export type RenderReply =
  | ({ id: number; ok: true } & RenderOk)
  | ({ id: number; ok: false } & RenderErr)
  | ({ id: number } & RenderProgress);

