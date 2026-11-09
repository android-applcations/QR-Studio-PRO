import Dexie, { type Table } from "dexie";
import type {
  AssetRecord,
  BatchRecord,
  CategoryRecord,
  HistoryRecord,
  QrRecord,
  SettingRecord,
  TemplateRecord,
  Tx,
} from "../core/types";
import { DEFAULT_DESIGN, sanitizeDesign } from "../core/designDefaults";
import { blobToDataUrl, dataUrlToBlob } from "../engine/raster";

export const DB_VERSION = 2;
export const BACKUP_FORMAT = 1;

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

class AppDB extends Dexie {
  qr_codes!: Table<QrRecord, number>;
  scan_history!: Table<HistoryRecord, number>;
  templates!: Table<TemplateRecord, number>;
  categories!: Table<CategoryRecord, number>;
  settings!: Table<SettingRecord, string>;
  qr_batches!: Table<BatchRecord, number>;
  assets!: Table<AssetRecord, number>;

  constructor() {
    super("qr_studio_pro");
    // v1: original schema
    this.version(1).stores({
      qr_codes: "++id, name, type, created_at, updated_at, favorite, category",
      scan_history: "++id, type, scanned_at",
      templates: "++id, name, created_at",
      categories: "++id, &name, created_at",
      settings: "key",
      qr_batches: "++id, created_at",
    });
    // v2: unique ids for dedupe/backup merge, batch link, assets (Blob logos), action index
    this.version(2)
      .stores({
        qr_codes: "++id, &uid, name, type, created_at, updated_at, favorite, category, batchId",
        scan_history: "++id, type, scanned_at, action",
        templates: "++id, &uid, name, created_at",
        categories: "++id, &name, created_at",
        settings: "key",
        qr_batches: "++id, created_at",
        assets: "++id, created_at",
      })
      .upgrade(async (tx) => {
        await tx.table("qr_codes").toCollection().modify((r: Partial<QrRecord>) => {
          if (!r.uid) r.uid = uid();
          if (!r.description) r.description = "";
          if (!r.form_values) r.form_values = {};
        });
        await tx.table("templates").toCollection().modify((r: Partial<TemplateRecord>) => {
          if (!r.uid) r.uid = uid();
        });
        await tx.table("scan_history").toCollection().modify((r: Partial<HistoryRecord>) => {
          if (!r.action) r.action = "scan";
        });
      });
  }
}

export const db = new AppDB();

// ---------- In-flight write tracking ----------
// Lets the app defer a destructive action (e.g. the page reload that applies a
// service-worker update) until every pending IndexedDB write has settled.
// Pure bookkeeping: it does not change the schema, the database name or any data.
let pendingWrites = 0;

function track<T>(p: Promise<T>): Promise<T> {
  pendingWrites++;
  const done = () => {
    pendingWrites = Math.max(0, pendingWrites - 1);
  };
  p.then(done, done);
  return p;
}

/** Resolves true when no IndexedDB write is in flight (or after `timeoutMs`). */
export async function whenWritesIdle(timeoutMs = 6000): Promise<boolean> {
  const start = Date.now();
  while (pendingWrites > 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 80));
  }
  return pendingWrites === 0;
}

export class AppError extends Error {
  constructor(public tx: Tx, public code: string) {
    super(code);
  }
}

export function describeError(e: unknown): Tx {
  if (e instanceof AppError) return e.tx;
  const name = (e as { name?: string })?.name ?? "";
  if (name === "QuotaExceededError" || /quota/i.test(String((e as Error)?.message))) {
    return ["Storage is full. Export a backup and free some space.", "مساحة التخزين ممتلئة. صدّر نسخة احتياطية وأفرغ بعض المساحة."];
  }
  if (name === "InvalidStateError" || name === "UnknownError" || name === "OpenFailedError" || name === "DatabaseClosedError") {
    return ["Local database is unavailable (private mode or blocked storage).", "قاعدة البيانات المحلية غير متاحة (وضع خاص أو تخزين محظور)."];
  }
  const msg = (e as Error)?.message;
  if (msg === "CANVAS_UNSUPPORTED") return ["Image processing is not supported on this device.", "معالجة الصور غير مدعومة على هذا الجهاز."];
  if (msg === "QR_CAPACITY") return ["Content is too long for a QR code. Shorten it or lower the error correction level.", "المحتوى أطول من سعة رمز QR. اختصره أو خفّض مستوى تصحيح الأخطاء."];
  if (name === "NotAllowedError" || name === "SecurityError") return ["Permission denied by the device.", "تم رفض الإذن من الجهاز."];
  return ["Something went wrong. Please try again.", "حدث خطأ ما. حاول مرة أخرى."];
}

// ---------- Settings ----------
export async function loadSettings(): Promise<Record<string, unknown>> {
  const rows = await db.settings.toArray();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
export const putSetting = (key: string, value: unknown) => track(db.settings.put({ key, value }));

// ---------- QR codes ----------
const designKey = (r: Pick<QrRecord, "design_config">) => JSON.stringify(r.design_config);

export async function saveQr(input: Omit<QrRecord, "id" | "uid" | "created_at" | "updated_at" | "favorite" | "category" | "description"> & Partial<QrRecord>): Promise<QrRecord> {
  return track(db.transaction("rw", db.qr_codes, async () => {
    const now = Date.now();
    if (input.id != null) {
      const cur = await db.qr_codes.get(input.id);
      if (cur) {
        const next: QrRecord = { ...cur, ...input, id: cur.id, uid: cur.uid, created_at: cur.created_at, updated_at: now } as QrRecord;
        await db.qr_codes.put(next);
        return next;
      }
    }
    // prevent unintended duplicates: identical content + type + design
    const same = await db.qr_codes.where("type").equals(input.type).filter((r) => r.content === input.content && designKey(r) === designKey(input as QrRecord)).first();
    if (same && !input.batchId) {
      const next = { ...same, name: input.name || same.name, form_values: input.form_values, updated_at: now };
      await db.qr_codes.put(next);
      return next;
    }
    const rec: QrRecord = {
      uid: uid(),
      description: "",
      favorite: 0,
      category: "",
      created_at: now,
      updated_at: now,
      ...input,
    } as QrRecord;
    delete rec.id;
    rec.id = await db.qr_codes.add(rec);
    return rec;
  }));
}

export const listQr = () => db.qr_codes.toArray();
export const getQr = (id: number) => db.qr_codes.get(id);
export const deleteQr = (ids: number[]) => track(db.qr_codes.bulkDelete(ids));
export const restoreQr = (recs: QrRecord[]) => track(db.qr_codes.bulkPut(recs));
export const patchQr = (id: number, patch: Partial<QrRecord>) => track(db.qr_codes.update(id, { ...patch, updated_at: Date.now() }));
export const patchManyQr = (ids: number[], patch: Partial<QrRecord>) =>
  track(db.transaction("rw", db.qr_codes, async () => {
    const now = Date.now();
    await Promise.all(ids.map((id) => db.qr_codes.update(id, { ...patch, updated_at: now })));
  }));

export async function duplicateQr(id: number, suffix: string): Promise<QrRecord | null> {
  const cur = await db.qr_codes.get(id);
  if (!cur) return null;
  const now = Date.now();
  const copy: QrRecord = { ...cur, uid: uid(), name: `${cur.name} ${suffix}`, created_at: now, updated_at: now, favorite: 0 };
  delete copy.id;
  copy.id = await db.qr_codes.add(copy);
  return copy;
}

// ---------- History ----------
export async function addHistory(rec: Omit<HistoryRecord, "id">): Promise<void> {
  await track(db.transaction("rw", db.scan_history, async () => {
    const last = await db.scan_history.orderBy("scanned_at").last();
    if (last && last.content === rec.content && last.action === rec.action && rec.scanned_at - last.scanned_at < 4000) return;
    await db.scan_history.add(rec as HistoryRecord);
    const count = await db.scan_history.count();
    if (count > 2000) {
      const old = await db.scan_history.orderBy("scanned_at").limit(count - 2000).primaryKeys();
      await db.scan_history.bulkDelete(old);
    }
  }));
}
export const listHistory = () => db.scan_history.orderBy("scanned_at").reverse().toArray();
export const deleteHistory = (ids: number[]) => track(db.scan_history.bulkDelete(ids));
export const clearHistory = () => track(db.scan_history.clear());
export const restoreHistory = (recs: HistoryRecord[]) => track(db.scan_history.bulkPut(recs));

// ---------- Templates ----------
export const listTemplates = () => db.templates.orderBy("created_at").reverse().toArray();
export async function addTemplate(name: string, design: QrRecord["design_config"]): Promise<TemplateRecord> {
  const rec: TemplateRecord = { uid: uid(), name, design_config: design, created_at: Date.now() };
  rec.id = await track(db.templates.add(rec));
  return rec;
}
export const deleteTemplate = (id: number) => track(db.templates.delete(id));

// ---------- Categories ----------
export const listCategories = () => db.categories.orderBy("created_at").toArray();
export async function addCategory(name: string): Promise<void> {
  const clean = name.trim().slice(0, 40);
  if (!clean) return;
  if (await db.categories.where("name").equals(clean).first()) throw new AppError(["Category already exists", "التصنيف موجود مسبقاً"], "DUP");
  await track(db.categories.add({ name: clean, created_at: Date.now() }));
}
export async function deleteCategory(id: number): Promise<void> {
  await track(db.transaction("rw", db.categories, db.qr_codes, async () => {
    const cat = await db.categories.get(id);
    if (!cat) return;
    await db.qr_codes.where("category").equals(cat.name).modify({ category: "" });
    await db.categories.delete(id);
  }));
}

// ---------- Assets (logo blobs) ----------
export async function saveAsset(blob: Blob): Promise<number> {
  return track(db.assets.add({ blob, created_at: Date.now() }));
}
const logoCache = new Map<number, string>();
export async function getLogoDataUrl(id: number): Promise<string | null> {
  const hit = logoCache.get(id);
  if (hit) return hit;
  const rec = await db.assets.get(id);
  if (!rec) return null;
  const url = await blobToDataUrl(rec.blob);
  logoCache.set(id, url);
  return url;
}
export function primeLogoCache(id: number, url: string) {
  logoCache.set(id, url);
}

// ---------- Batches ----------
export async function saveBatch(name: string, items: Omit<QrRecord, "id" | "uid" | "batchId" | "created_at" | "updated_at">[]): Promise<number> {
  return track(db.transaction("rw", db.qr_batches, db.qr_codes, async () => {
    const now = Date.now();
    const batchId = await db.qr_batches.add({ name, created_at: now, items_count: items.length });
    await db.qr_codes.bulkAdd(items.map((it, i) => ({ ...it, uid: uid(), batchId, created_at: now + i, updated_at: now + i }) as QrRecord));
    return batchId;
  }));
}

// ---------- Stats & storage ----------
export interface Stats {
  created: number;
  saved: number;
  favorites: number;
  scanned: number;
  exported: number;
  byType: [string, number][];
}

export async function getStats(): Promise<Stats> {
  const [saved, favorites, hist, qrs] = await Promise.all([
    db.qr_codes.count(),
    db.qr_codes.where("favorite").equals(1).count(),
    db.scan_history.toArray(),
    db.qr_codes.toArray(),
  ]);
  const byTypeMap = new Map<string, number>();
  for (const q of qrs) byTypeMap.set(q.type, (byTypeMap.get(q.type) ?? 0) + 1);
  return {
    saved,
    favorites,
    created: hist.filter((h) => h.action === "create" || h.action === "save").length,
    scanned: hist.filter((h) => h.action === "scan").length,
    exported: hist.filter((h) => h.action === "export").length,
    byType: [...byTypeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
  };
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    }
  } catch {
    /* unsupported */
  }
  return null;
}

/**
 * How full the browser's storage for this origin is.
 *
 * `quota` is the whole bucket the browser gave us, not a hard promise, and some
 * browsers report nothing at all — hence `percent: null` when we cannot know.
 */
export interface StorageAudit {
  usage: number;
  quota: number;
  /** 0–100, or null when the browser will not say */
  percent: number | null;
  /** saved codes currently taking up space */
  codes: number;
  /** entries in the scan history */
  history: number;
}

export async function storageAudit(): Promise<StorageAudit> {
  const [est, codes, history] = await Promise.all([storageEstimate(), db.qr_codes.count(), db.scan_history.count()]);
  const usage = est?.usage ?? 0;
  const quota = est?.quota ?? 0;
  return { usage, quota, percent: quota > 0 ? Math.min(100, (usage / quota) * 100) : null, codes, history };
}

/**
 * Free space the careful way: drop the oldest codes that are not favourites,
 * and trim the scan history to its newest entries.
 *
 * `keep` is a floor, not a target — nothing is deleted while there are fewer
 * saved codes than that, so an audit can call this without fear.
 */
export async function pruneOldest(keep = 200, keepHistory = 300): Promise<{ codes: number; history: number }> {
  const [codes, history] = await Promise.all([
    db.qr_codes.orderBy("created_at").reverse().toArray(),
    db.scan_history.count(),
  ]);
  let removedCodes = 0;
  if (codes.length > keep) {
    // Newest first, so the tail is the oldest — and favourites are never touched.
    const doomed = codes.slice(keep).filter((c) => !c.favorite).map((c) => c.id).filter((id): id is number => typeof id === "number");
    if (doomed.length) {
      await deleteQr(doomed);
      removedCodes = doomed.length;
    }
  }
  let removedHistory = 0;
  if (history > keepHistory) {
    const oldest = await db.scan_history.orderBy("scanned_at").limit(history - keepHistory).toArray();
    const ids = oldest.map((h) => h.id).filter((id): id is number => typeof id === "number");
    if (ids.length) {
      await deleteHistory(ids);
      removedHistory = ids.length;
    }
  }
  return { codes: removedCodes, history: removedHistory };
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function wipeAll(): Promise<void> {
  await track(db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  }));
}

// ---------- Backup ----------
interface BackupFile {
  app: "QR Studio Pro";
  format: number;
  dbVersion: number;
  exported_at: number;
  data: {
    qr_codes: QrRecord[];
    scan_history: HistoryRecord[];
    templates: TemplateRecord[];
    categories: CategoryRecord[];
    settings: SettingRecord[];
    qr_batches: BatchRecord[];
    assets: { id: number; created_at: number; dataUrl: string }[];
  };
}

export async function exportBackup(): Promise<Blob> {
  const [qr_codes, scan_history, templates, categories, settings, qr_batches, assets] = await Promise.all([
    db.qr_codes.toArray(),
    db.scan_history.toArray(),
    db.templates.toArray(),
    db.categories.toArray(),
    db.settings.toArray(),
    db.qr_batches.toArray(),
    db.assets.toArray(),
  ]);
  const encAssets = [];
  for (const a of assets) encAssets.push({ id: a.id as number, created_at: a.created_at, dataUrl: await blobToDataUrl(a.blob) });
  const file: BackupFile = {
    app: "QR Studio Pro",
    format: BACKUP_FORMAT,
    dbVersion: DB_VERSION,
    exported_at: Date.now(),
    data: { qr_codes, scan_history, templates, categories, settings: settings.filter((s) => s.key !== "lastProject"), qr_batches, assets: encAssets },
  };
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

export interface ParsedBackup {
  file: BackupFile;
  counts: { qr: number; templates: number; categories: number; history: number; skipped: number };
  exportedAt: number;
}

const str = (v: unknown, max: number, fb = "") => (typeof v === "string" ? v.slice(0, max) : fb);
const numOr = (v: unknown, fb: number) => (typeof v === "number" && isFinite(v) ? v : fb);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, 50000) : []);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Validate and sanitize an untrusted backup file. Throws AppError on failure. */
export function parseBackup(text: string): ParsedBackup {
  const bad = (en: string, ar: string) => new AppError([en, ar], "BAD_BACKUP");
  if (text.length > 120_000_000) throw bad("Backup file is too large", "ملف النسخة الاحتياطية كبير جداً");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw bad("The file is not a valid backup (invalid JSON)", "الملف ليس نسخة احتياطية صالحة (JSON غير صحيح)");
  }
  const root = rec(json);
  if (!root || root.app !== "QR Studio Pro" || !rec(root.data)) throw bad("This file was not created by QR Studio Pro", "هذا الملف لم يُنشأ بواسطة QR Studio Pro");
  const format = numOr(root.format, 0);
  if (format < 1) throw bad("Unknown backup format", "صيغة النسخة الاحتياطية غير معروفة");
  if (format > BACKUP_FORMAT) throw bad("Backup was created by a newer app version. Update the app first.", "النسخة أُنشئت بإصدار أحدث من التطبيق. حدّث التطبيق أولاً.");
  const data = rec(root.data) as Record<string, unknown>;
  let skipped = 0;

  const qr_codes: QrRecord[] = [];
  for (const raw of arr(data.qr_codes)) {
    const r = rec(raw);
    if (!r || typeof r.content !== "string" || typeof r.type !== "string" || r.content.length > 6000) { skipped++; continue; }
    const fv: Record<string, string> = {};
    const frv = rec(r.form_values);
    if (frv) for (const [k, v] of Object.entries(frv)) if (typeof v === "string") fv[k.slice(0, 40)] = v.slice(0, 3000);
    qr_codes.push({
      id: typeof r.id === "number" ? r.id : undefined,
      uid: str(r.uid, 80) || uid(),
      name: str(r.name, 120, "QR"),
      description: str(r.description, 400),
      content: r.content,
      type: str(r.type, 30),
      form_values: fv,
      design_config: sanitizeDesign(r.design_config),
      created_at: numOr(r.created_at, Date.now()),
      updated_at: numOr(r.updated_at, Date.now()),
      favorite: r.favorite === 1 ? 1 : 0,
      category: str(r.category, 40),
      batchId: typeof r.batchId === "number" ? r.batchId : null,
    });
  }
  const scan_history: HistoryRecord[] = [];
  for (const raw of arr(data.scan_history)) {
    const r = rec(raw);
    if (!r || typeof r.content !== "string") { skipped++; continue; }
    const action = ["scan", "create", "export", "save"].includes(r.action as string) ? (r.action as HistoryRecord["action"]) : "scan";
    scan_history.push({ id: typeof r.id === "number" ? r.id : undefined, content: r.content.slice(0, 2000), type: str(r.type, 30, "text"), scanned_at: numOr(r.scanned_at, Date.now()), action, name: str(r.name, 120) || undefined });
  }
  const templates: TemplateRecord[] = [];
  for (const raw of arr(data.templates)) {
    const r = rec(raw);
    if (!r) { skipped++; continue; }
    templates.push({ id: typeof r.id === "number" ? r.id : undefined, uid: str(r.uid, 80) || uid(), name: str(r.name, 80, "Template"), design_config: sanitizeDesign(r.design_config), created_at: numOr(r.created_at, Date.now()) });
  }
  const categories: CategoryRecord[] = [];
  for (const raw of arr(data.categories)) {
    const r = rec(raw);
    if (!r || typeof r.name !== "string" || !r.name.trim()) { skipped++; continue; }
    categories.push({ id: typeof r.id === "number" ? r.id : undefined, name: r.name.trim().slice(0, 40), created_at: numOr(r.created_at, Date.now()) });
  }
  const settings: SettingRecord[] = [];
  for (const raw of arr(data.settings)) {
    const r = rec(raw);
    if (r && typeof r.key === "string" && ["lang", "theme", "saveHistory", "autoSave"].includes(r.key)) settings.push({ key: r.key, value: r.value });
  }
  const qr_batches: BatchRecord[] = [];
  for (const raw of arr(data.qr_batches)) {
    const r = rec(raw);
    if (r) qr_batches.push({ id: typeof r.id === "number" ? r.id : undefined, name: str(r.name, 120, "Batch"), created_at: numOr(r.created_at, Date.now()), items_count: numOr(r.items_count, 0) });
  }
  const assets: BackupFile["data"]["assets"] = [];
  for (const raw of arr(data.assets)) {
    const r = rec(raw);
    if (r && typeof r.id === "number" && typeof r.dataUrl === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(r.dataUrl)) assets.push({ id: r.id, created_at: numOr(r.created_at, Date.now()), dataUrl: r.dataUrl });
    else if (r) skipped++;
  }
  return {
    file: { app: "QR Studio Pro", format, dbVersion: numOr(root.dbVersion, 1), exported_at: numOr(root.exported_at, 0), data: { qr_codes, scan_history, templates, categories, settings, qr_batches, assets } },
    counts: { qr: qr_codes.length, templates: templates.length, categories: categories.length, history: scan_history.length, skipped },
    exportedAt: numOr(root.exported_at, 0),
  };
}

export async function importBackup(p: ParsedBackup, mode: "merge" | "replace"): Promise<void> {
  const d = p.file.data;
  const assetBlobs = new Map<number, Blob>();
  for (const a of d.assets) assetBlobs.set(a.id, await dataUrlToBlob(a.dataUrl));

  await track(db.transaction("rw", db.tables, async () => {
    if (mode === "replace") {
      for (const t of db.tables) if (t.name !== "settings") await t.clear();
      await db.assets.bulkAdd([...assetBlobs.entries()].map(([id, blob]) => ({ id, blob, created_at: Date.now() })));
      await db.categories.bulkAdd(d.categories as CategoryRecord[]);
      await db.qr_batches.bulkAdd(d.qr_batches as BatchRecord[]);
      await db.qr_codes.bulkAdd(d.qr_codes.map((r) => ({ ...r })));
      await db.templates.bulkAdd(d.templates.map((r) => ({ ...r })));
      await db.scan_history.bulkAdd(d.scan_history.map((r) => ({ ...r })));
      for (const s of d.settings) await db.settings.put(s);
      return;
    }
    // merge
    const assetMap = new Map<number, number>();
    for (const [oldId, blob] of assetBlobs) assetMap.set(oldId, await db.assets.add({ blob, created_at: Date.now() }));
    const remap = (dsg: QrRecord["design_config"]) => ({ ...dsg, logoId: dsg.logoId != null ? (assetMap.get(dsg.logoId) ?? null) : null });
    const batchMap = new Map<number, number>();
    for (const b of d.qr_batches) {
      const nb = { ...b };
      const oldId = nb.id;
      delete nb.id;
      const newId = await db.qr_batches.add(nb);
      if (oldId != null) batchMap.set(oldId, newId);
    }
    const existingUids = new Set((await db.qr_codes.toArray()).map((r) => r.uid));
    for (const r of d.qr_codes) {
      if (existingUids.has(r.uid)) continue;
      const nr = { ...r, design_config: remap(r.design_config), batchId: r.batchId != null ? (batchMap.get(r.batchId) ?? null) : null };
      delete nr.id;
      await db.qr_codes.add(nr);
    }
    const tUids = new Set((await db.templates.toArray()).map((r) => r.uid));
    for (const t of d.templates) {
      if (tUids.has(t.uid)) continue;
      const nt = { ...t, design_config: remap(t.design_config) };
      delete nt.id;
      await db.templates.add(nt);
    }
    const names = new Set((await db.categories.toArray()).map((c) => c.name));
    for (const c of d.categories) {
      if (names.has(c.name)) continue;
      const nc = { ...c };
      delete nc.id;
      await db.categories.add(nc);
    }
    const seen = new Set((await db.scan_history.toArray()).map((h) => `${h.action}|${h.scanned_at}|${h.content}`));
    for (const h of d.scan_history) {
      if (seen.has(`${h.action}|${h.scanned_at}|${h.content}`)) continue;
      const nh = { ...h };
      delete nh.id;
      await db.scan_history.add(nh);
    }
  }));
}

export { DEFAULT_DESIGN };
