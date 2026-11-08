import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DesignConfig, FormValues, Project, QrRecord, QrTypeDef } from "../core/types";
import { DEFAULT_DESIGN, sanitizeDesign } from "../core/designDefaults";
import { buildContent, defaultValues, TYPE_BY_ID, type BuildResult } from "../core/qrTypes";
import { getLogoDataUrl, primeLogoCache, putSetting, saveAsset, saveQr } from "../db/db";
import { blobToDataUrl, prepareLogoBlob } from "../engine/raster";
import { useApp } from "./AppContext";

export type CreateStep = "pick" | "form" | "result" | "batch";

interface Ctx {
  project: Project;
  type: QrTypeDef;
  build: BuildResult;
  logoHref: string | null;
  step: CreateStep;
  setStep: (s: CreateStep) => void;
  selectType: (id: string) => void;
  setValues: (v: FormValues) => void;
  setName: (n: string) => void;
  setDesign: (patch: Partial<DesignConfig>, coalesceKey?: string) => void;
  replaceDesign: (d: DesignConfig) => void;
  resetDesign: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  loadRecord: (r: QrRecord) => void;
  loadRaw: (content: string, typeId: string) => void;
  newProject: () => void;
  save: (opts?: { silent?: boolean }) => Promise<QrRecord | null>;
  uploadLogo: (file: File) => Promise<void>;
  removeLogo: () => void;
}

const PCtx = createContext<Ctx | null>(null);
export const useProject = (): Ctx => {
  const c = useContext(PCtx);
  if (!c) throw new Error("ProjectProvider missing");
  return c;
};

function restore(raw: unknown): Project | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.typeId !== "string" || !TYPE_BY_ID[r.typeId]) return null;
  const values: FormValues = {};
  if (r.values && typeof r.values === "object") for (const [k, v] of Object.entries(r.values)) if (typeof v === "string") values[k] = v.slice(0, 3000);
  return { typeId: r.typeId, values, design: sanitizeDesign(r.design), name: typeof r.name === "string" ? r.name.slice(0, 120) : "", savedId: typeof r.savedId === "number" ? r.savedId : null };
}

const freshDesign = (): DesignConfig => ({ ...DEFAULT_DESIGN, gradient: { ...DEFAULT_DESIGN.gradient } });
const blank = (typeId = "url"): Project => ({ typeId, values: defaultValues(TYPE_BY_ID[typeId]), design: freshDesign(), name: "", savedId: null });

interface S {
  project: Project;
  past: DesignConfig[];
  future: DesignConfig[];
  lastKey: string;
  lastAt: number;
}

/** Pure helper: apply a design change while recording undo history. */
function withDesign(s: S, next: DesignConfig, key: string | undefined, now: number): S {
  if (key && s.lastKey === key && now - s.lastAt < 900) {
    return { ...s, project: { ...s.project, design: next }, lastAt: now };
  }
  return { project: { ...s.project, design: next }, past: [...s.past.slice(-49), s.project.design], future: [], lastKey: key ?? "", lastAt: now };
}

export function ProjectProvider({ initial, children }: { initial: Record<string, unknown>; children: ReactNode }) {
  const { t, toast, fail, logActivity, bumpData, autoSave } = useApp();
  const restored = useMemo(() => restore(initial.lastProject), [initial.lastProject]);
  const [s, setS] = useState<S>(() => ({ project: restored ?? blank(), past: [], future: [], lastKey: "", lastAt: 0 }));
  const [step, setStep] = useState<CreateStep>(() => (restored && Object.values(restored.values).some((v) => v.trim()) ? "form" : "pick"));
  const [logoHref, setLogoHref] = useState<string | null>(null);
  const project = s.project;

  const type = TYPE_BY_ID[project.typeId] ?? TYPE_BY_ID.url;
  const build = useMemo(() => buildContent(type, project.values), [type, project.values]);

  useEffect(() => {
    let alive = true;
    if (project.design.logoId == null) {
      setLogoHref(null);
      return;
    }
    getLogoDataUrl(project.design.logoId).then((u) => alive && setLogoHref(u)).catch(() => alive && setLogoHref(null));
    return () => { alive = false; };
  }, [project.design.logoId]);

  // Persist last project (restored on next launch). Sensitive types never persist their values.
  useEffect(() => {
    const id = setTimeout(() => {
      const toStore = type.sensitive ? { ...project, values: {} } : project;
      putSetting("lastProject", toStore).catch(() => { /* best effort */ });
    }, 600);
    return () => clearTimeout(id);
  }, [project, type]);

  const setDesign = useCallback((patch: Partial<DesignConfig>, key?: string) => {
    const now = Date.now();
    setS((cur) => {
      const d = cur.project.design;
      const next = { ...d, ...patch, gradient: patch.gradient ? { ...d.gradient, ...patch.gradient } : d.gradient };
      return withDesign(cur, next, key, now);
    });
  }, []);

  const replaceDesign = useCallback((d: DesignConfig) => {
    const now = Date.now();
    setS((cur) => withDesign(cur, d, undefined, now));
  }, []);

  const resetDesign = useCallback(() => replaceDesign(freshDesign()), [replaceDesign]);

  const undo = useCallback(() => {
    setS((cur) => {
      if (!cur.past.length) return cur;
      const prev = cur.past[cur.past.length - 1];
      return { project: { ...cur.project, design: prev }, past: cur.past.slice(0, -1), future: [cur.project.design, ...cur.future], lastKey: "", lastAt: 0 };
    });
  }, []);

  const redo = useCallback(() => {
    setS((cur) => {
      if (!cur.future.length) return cur;
      const next = cur.future[0];
      return { project: { ...cur.project, design: next }, past: [...cur.past, cur.project.design], future: cur.future.slice(1), lastKey: "", lastAt: 0 };
    });
  }, []);

  const patchProject = useCallback((fn: (p: Project) => Project) => setS((cur) => ({ ...cur, project: fn(cur.project) })), []);

  const selectType = useCallback((id: string) => {
    if (!TYPE_BY_ID[id]) return;
    patchProject((p) => ({ ...p, typeId: id, values: defaultValues(TYPE_BY_ID[id]), name: "", savedId: null }));
    setStep("form");
  }, [patchProject]);

  const setValues = useCallback((v: FormValues) => patchProject((p) => ({ ...p, values: v })), [patchProject]);
  const setName = useCallback((n: string) => patchProject((p) => ({ ...p, name: n })), [patchProject]);

  const loadRecord = useCallback((r: QrRecord) => {
    const ty = TYPE_BY_ID[r.type] ? r.type : "raw";
    const values: FormValues = ty === "raw" && !Object.keys(r.form_values ?? {}).length ? { text: r.content } : r.form_values ?? {};
    setS({ project: { typeId: ty, values, design: sanitizeDesign(r.design_config), name: r.name, savedId: r.id ?? null }, past: [], future: [], lastKey: "", lastAt: 0 });
    setStep("form");
  }, []);

  const loadRaw = useCallback((content: string, typeId: string) => {
    const values: FormValues = typeId === "url" ? { url: content } : { text: content };
    patchProject((p) => ({ ...p, typeId: typeId === "url" ? "url" : "raw", values, name: "", savedId: null }));
    setStep("form");
  }, [patchProject]);

  const newProject = useCallback(() => {
    patchProject((p) => ({ ...blank(), design: p.design }));
    setStep("pick");
  }, [patchProject]);

  const ref = useRef(project);
  ref.current = project;

  const save = useCallback(async (opts?: { silent?: boolean }) => {
    const p = ref.current;
    const ty = TYPE_BY_ID[p.typeId];
    const b = buildContent(ty, p.values);
    if (!b.valid) {
      toast(["Complete the required fields first", "أكمل الحقول المطلوبة أولاً"], "err");
      return null;
    }
    try {
      const snippet = b.content.replace(/\s+/g, " ").slice(0, 28);
      const name = p.name.trim() || `${t(ty.title)} · ${snippet}`;
      const rec = await saveQr({ id: p.savedId ?? undefined, name, content: b.content, type: p.typeId, form_values: p.values, design_config: p.design });
      patchProject((cur) => (cur.typeId === p.typeId ? { ...cur, savedId: rec.id ?? null, name: cur.name || name } : cur));
      if (!opts?.silent) {
        logActivity({ action: "save", type: p.typeId, content: b.content, name });
        toast(["Saved to My codes", "تم الحفظ في رموزي"]);
      }
      bumpData();
      return rec;
    } catch (e) {
      fail(e);
      return null;
    }
  }, [t, toast, fail, logActivity, bumpData, patchProject]);

  // Optional auto-save of the current project to the library (updates the same record)
  useEffect(() => {
    if (!autoSave || !build.valid) return;
    const id = setTimeout(() => { void save({ silent: true }); }, 1800);
    return () => clearTimeout(id);
  }, [autoSave, build.valid, build.content, project.design, project.name, save]);

  const uploadLogo = useCallback(async (file: File) => {
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.type)) {
      toast(["Choose a PNG, JPG, WebP or SVG image", "اختر صورة بصيغة PNG أو JPG أو WebP أو SVG"], "err");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast(["Image is larger than 8 MB", "حجم الصورة أكبر من 8 ميغابايت"], "err");
      return;
    }
    try {
      const blob = await prepareLogoBlob(file);
      const id = await saveAsset(blob);
      primeLogoCache(id, await blobToDataUrl(blob));
      const ecc = ref.current.design.ecc;
      setDesign({ logoId: id, ecc: ecc === "L" || ecc === "M" ? "Q" : ecc });
    } catch (e) {
      fail(e);
    }
  }, [toast, fail, setDesign]);

  const removeLogo = useCallback(() => setDesign({ logoId: null }), [setDesign]);

  const value = useMemo<Ctx>(() => ({
    project, type, build, logoHref, step, setStep, selectType, setValues, setName, setDesign, replaceDesign, resetDesign,
    undo, redo, canUndo: s.past.length > 0, canRedo: s.future.length > 0, loadRecord, loadRaw, newProject, save, uploadLogo, removeLogo,
  }), [project, type, build, logoHref, step, selectType, setValues, setName, setDesign, replaceDesign, resetDesign, undo, redo, s.past.length, s.future.length, loadRecord, loadRaw, newProject, save, uploadLogo, removeLogo]);

  return <PCtx.Provider value={value}>{children}</PCtx.Provider>;
}
