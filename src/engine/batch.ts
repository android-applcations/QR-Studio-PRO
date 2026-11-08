import JSZip from "jszip";
import type { DesignConfig, Tx } from "../core/types";
import { buildContent, TYPE_BY_ID } from "../core/qrTypes";
import { renderQrSvg, QrCapacityError } from "./designEngine";
import { canvasToBlob, rasterize } from "./raster";
import { sanitizeFilename } from "./exportEngine";

export type BatchKind = "text" | "url" | "phone" | "email";
const KIND_FIELD: Record<BatchKind, string> = { text: "text", url: "url", phone: "phone", email: "to" };

export interface BatchRow {
  line: number;
  name: string;
  content: string;
  raw: string;
  error?: Tx;
}

export interface GeneratedItem {
  name: string;
  content: string;
  svg: string;
  width: number;
  height: number;
}

/** CSV parser supporting quotes, escaped quotes and , ; or tab delimiters. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows.slice(0, 5000);
}

export function buildRows(table: string[][], kind: BatchKind, contentCol: number, nameCol: number): BatchRow[] {
  const type = TYPE_BY_ID[kind === "phone" ? "phone" : kind];
  const seen = new Set<string>();
  return table.map((cells, i) => {
    const raw = (cells[contentCol] ?? "").trim();
    const name = nameCol >= 0 ? (cells[nameCol] ?? "").trim() : "";
    const row: BatchRow = { line: i + 1, name, raw, content: "" };
    if (!raw) {
      row.error = ["Empty value", "قيمة فارغة"];
      return row;
    }
    const res = buildContent(type, { [KIND_FIELD[kind]]: raw });
    if (!res.valid) {
      row.error = Object.values(res.errors)[0] ?? ["Invalid value", "قيمة غير صحيحة"];
      return row;
    }
    if (seen.has(res.content)) {
      row.error = ["Duplicate value", "قيمة مكررة"];
      return row;
    }
    seen.add(res.content);
    row.content = res.content;
    return row;
  });
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Generates vector codes in small slices, yielding to the UI between slices. */
export async function generateBatch(
  rows: BatchRow[],
  design: DesignConfig,
  logoHref: string | null,
  autoName: string,
  onProgress: (done: number, total: number) => void,
  cancel: { cancelled: boolean },
): Promise<{ items: GeneratedItem[]; failed: BatchRow[] }> {
  const valid = rows.filter((r) => !r.error);
  const items: GeneratedItem[] = [];
  const failed: BatchRow[] = [];
  for (let i = 0; i < valid.length; i++) {
    if (cancel.cancelled) break;
    const r = valid[i];
    try {
      const out = renderQrSvg(r.content, design, { logoHref });
      items.push({ name: r.name || `${autoName} ${items.length + 1}`, content: r.content, svg: out.svg, width: out.width, height: out.height });
    } catch (e) {
      failed.push({ ...r, error: e instanceof QrCapacityError ? ["Too long for QR", "أطول من سعة QR"] : ["Generation failed", "فشل التوليد"] });
    }
    if (i % 6 === 5) {
      onProgress(i + 1, valid.length);
      await tick();
    }
  }
  onProgress(valid.length, valid.length);
  return { items, failed };
}

export type ZipFormat = "png" | "jpg" | "svg";

export async function buildZip(
  items: GeneratedItem[],
  format: ZipFormat,
  size: number,
  onProgress: (done: number, total: number) => void,
): Promise<Blob> {
  const zip = new JSZip();
  const used = new Map<string, number>();
  const manifest = ["file,name,content"];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const base = sanitizeFilename(it.name, `qr-${i + 1}`);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const file = `${n > 1 ? `${base}-${n}` : base}.${format}`;
    if (format === "svg") zip.file(file, it.svg);
    else {
      const canvas = await rasterize(it.svg, size, (size * it.height) / it.width, "#ffffff");
      zip.file(file, await canvasToBlob(canvas, format === "jpg" ? "image/jpeg" : "image/png", 0.95));
    }
    manifest.push([file, it.name, it.content].map((c) => `"${c.replace(/"/g, '""')}"`).join(","));
    onProgress(i + 1, items.length);
    if (i % 3 === 2) await tick();
  }
  zip.file("manifest.csv", "\uFEFF" + manifest.join("\n"));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
