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

/**
 * One printed page: the design, the paper and how big it should be on paper.
 * The page is rasterised and wrapped into a PDF entirely inside the worker.
 */
export interface PdfJob {
  kind: "pdf";
  svg: string;
  /** height / width of the rendered code */
  ratio: number;
  paper: "fit" | "a4" | "a5" | "letter";
  printMm: number;
  title?: string;
}

/**
 * A whole batch turned into an archive. Zipping hundreds of images costs more
 * than rendering them, so it happens where the rendering happened.
 */
export interface ZipJob {
  kind: "zip";
  items: { name: string; content: string; svg: string; width: number; height: number }[];
  format: "png" | "jpg" | "svg";
  /** longest side, in pixels */
  size: number;
}

/** The images for a print sheet, ready to be embedded in the HTML. */
export interface SheetJob {
  kind: "sheet";
  items: { content: string; design: DesignConfig; logoHref: string | null }[];
  /** longest side, in pixels */
  px: number;
}

export type RenderJob = GenerateJob | RasterJob | PdfJob | ZipJob | SheetJob;

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
  /** for `raster` and `pdf` */
  blob?: Blob;
  /** for `zip`: the finished archive */
  archive?: Blob;
  /** for `sheet`: one PNG per item, in order */
  images?: Blob[];
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

