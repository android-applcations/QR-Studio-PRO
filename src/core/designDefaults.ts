import type { DesignConfig, Tx } from "./types";

export const DEFAULT_DESIGN: DesignConfig = {
  fg: "#0b0f19",
  bg: "#ffffff",
  bgTransparent: false,
  gradient: { enabled: false, type: "linear", from: "#6d5efc", to: "#18c8ff", angle: 45 },
  dotStyle: "square",
  eyeFrameStyle: "square",
  eyeBallStyle: "square",
  eyeFrameColor: null,
  eyeBallColor: null,
  logoId: null,
  logoSize: 20,
  logoPadding: 1,
  logoShape: "square",
  logoBg: "#ffffff",
  frameStyle: "none",
  frameColor: "#0b0f19",
  frameText: "",
  frameTextPos: "bottom",
  frameTextColor: "#0b0f19",
  frameFont: "sans",
  frameFontScale: 1,
  ecc: "M",
  margin: 4,
  size: 1024,
};

export interface BuiltinTemplate {
  id: string;
  name: Tx;
  design: Partial<DesignConfig>;
  /** switch the project to this QR type when the template is applied */
  typeId?: string;
}

/**
 * Marks that ship with the app, so a template can carry one without the user
 * uploading anything.
 *
 * A design's `logoId` points at a logo the user stored in IndexedDB, so a
 * built-in mark needs an id that can never collide with one: negative ids are
 * never handed out by the store, and `builtinLogoHref` resolves them to the file.
 */
export const BUILTIN_LOGOS: Record<number, string> = {
  [-1]: "/brands/shamcash.png",
};

/** The official Sham Cash mark. */
export const SHAMCASH_LOGO_ID = -1;

/** The file behind a built-in mark, or null when this is a stored logo. */
export function builtinLogoHref(logoId: number | null | undefined): string | null {
  return typeof logoId === "number" && logoId < 0 ? BUILTIN_LOGOS[logoId] ?? null : null;
}

const g = (from: string, to: string, angle = 45) => ({ enabled: true, type: "linear" as const, from, to, angle });

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    /*
     * Sham Cash — built from the official material, not guessed:
     *   · the colours are the ones in the official mark itself (deep blue
     *     #374EAC → teal #4C9DA4);
     *   · "سهولة وأمان" is the wallet's own slogan, used on every official
     *     channel, so it is the caption rather than an English invention;
     *   · the QR holds only the wallet code, so the frame is where the name
     *     lives — the way the app's own "Receive" screen reads.
     */
    id: "shamcash",
    name: ["Sham Cash", "شام كاش"],
    typeId: "shamcash",
    design: {
      fg: "#2b4f95",
      gradient: g("#374eac", "#4c9da4", 135),
      dotStyle: "rounded",
      eyeFrameStyle: "rounded",
      eyeBallStyle: "rounded",
      frameStyle: "banner",
      frameColor: "#2b4f95",
      frameText: "شام كاش",
      frameTextColor: "#ffffff",
      frameFont: "sans",
      logoId: SHAMCASH_LOGO_ID,
      logoShape: "circle",
      logoSize: 22,
      ecc: "Q",
    },
  },
  {
    id: "business",
    name: ["Business", "الأعمال التجارية"],
    design: { fg: "#0f2a4a", dotStyle: "rounded", eyeFrameStyle: "rounded", eyeBallStyle: "rounded", frameStyle: "border", frameColor: "#0f2a4a", frameText: "SCAN ME", frameTextColor: "#0f2a4a", ecc: "Q" },
  },
  {
    id: "restaurant",
    name: ["Restaurant menu", "قائمة المطعم"],
    design: { fg: "#7a1f1f", dotStyle: "dots", eyeFrameStyle: "circle", eyeBallStyle: "circle", frameStyle: "banner", frameColor: "#7a1f1f", frameText: "MENU", frameTextColor: "#ffffff", frameFont: "serif", ecc: "Q" },
  },
  {
    id: "contact",
    name: ["Contact card", "بطاقة اتصال"],
    design: { fg: "#1b1f3b", gradient: g("#1b1f3b", "#6d5efc", 135), dotStyle: "classy", eyeFrameStyle: "leaf", eyeBallStyle: "leaf", frameStyle: "pill", frameColor: "#6d5efc", frameText: "SAVE CONTACT", frameTextColor: "#ffffff", ecc: "Q" },
  },
  {
    id: "store",
    name: ["Online store", "المتجر"],
    design: { fg: "#0b3d2e", gradient: g("#0b3d2e", "#1fae7a", 90), dotStyle: "rounded", eyeFrameStyle: "rounded", eyeBallStyle: "circle", frameStyle: "banner", frameColor: "#0b3d2e", frameText: "SHOP NOW", frameTextColor: "#ffffff", ecc: "Q" },
  },
  {
    id: "wifi",
    name: ["Wi-Fi network", "الشبكة اللاسلكية"],
    design: { fg: "#0a2540", gradient: g("#0a2540", "#0ea5e9", 60), dotStyle: "smallDots", eyeFrameStyle: "circle", eyeBallStyle: "circle", frameStyle: "border", frameColor: "#0a2540", frameText: "JOIN WI-FI", frameTextColor: "#0a2540", ecc: "M" },
  },
  {
    id: "product",
    name: ["Product label", "ملصق منتج"],
    design: { fg: "#111111", dotStyle: "square", eyeFrameStyle: "square", eyeBallStyle: "square", frameStyle: "text", frameText: "PRODUCT INFO", frameTextColor: "#111111", frameFont: "mono", ecc: "M" },
  },
  {
    id: "social",
    name: ["Social media", "وسائل التواصل"],
    design: { fg: "#c13584", gradient: g("#f58529", "#8134af", 45), dotStyle: "dots", eyeFrameStyle: "rounded", eyeBallStyle: "circle", frameStyle: "pill", frameColor: "#dd2a7b", frameText: "FOLLOW US", frameTextColor: "#ffffff", frameFont: "rounded", ecc: "Q" },
  },
  {
    id: "event",
    name: ["Event", "المناسبات"],
    design: { fg: "#3b1c6e", gradient: g("#3b1c6e", "#c026d3", 120), dotStyle: "diamond", eyeFrameStyle: "octagon", eyeBallStyle: "diamond", frameStyle: "banner", frameColor: "#3b1c6e", frameText: "JOIN THE EVENT", frameTextColor: "#ffffff", ecc: "Q" },
  },
  {
    id: "ads",
    name: ["Advertising", "الإعلانات"],
    design: { fg: "#111827", bg: "#ffe14d", dotStyle: "vbars", eyeFrameStyle: "rounded", eyeBallStyle: "rounded", frameStyle: "banner", frameColor: "#111827", frameText: "SCAN & WIN", frameTextColor: "#ffe14d", frameFont: "sans", ecc: "Q" },
  },
  {
    id: "profile",
    name: ["Personal profile", "الملف الشخصي"],
    design: { fg: "#064e3b", gradient: g("#064e3b", "#0891b2", 30), dotStyle: "rounded", eyeFrameStyle: "leaf", eyeBallStyle: "leaf", frameStyle: "text", frameText: "MY PROFILE", frameTextColor: "#064e3b", frameFont: "rounded", ecc: "Q" },
  },
  {
    id: "classic",
    name: ["Classic black", "كلاسيكي أسود"],
    design: {},
  },
  {
    id: "neon",
    name: ["Night neon", "نيون ليلي"],
    design: { fg: "#1d0b4f", gradient: g("#1d0b4f", "#0ea5e9", 45), bg: "#f4f0ff", dotStyle: "hbars", eyeFrameStyle: "circle", eyeBallStyle: "circle", ecc: "Q" },
  },
];

export function mergeDesign(base: DesignConfig, patch: Partial<DesignConfig>): DesignConfig {
  return {
    ...base,
    ...patch,
    gradient: { ...base.gradient, ...(patch.gradient ?? {}) },
  };
}

export function designFromTemplate(t: Partial<DesignConfig>, keep?: Pick<DesignConfig, "logoId" | "size">): DesignConfig {
  const d = mergeDesign(DEFAULT_DESIGN, t);
  if (keep) {
    d.size = keep.size;
    if (d.logoId == null) d.logoId = keep.logoId;
  }
  return d;
}

/** Validate & sanitize an unknown object into a DesignConfig (imports/backups). */
export function sanitizeDesign(raw: unknown): DesignConfig {
  const d = DEFAULT_DESIGN;
  if (!raw || typeof raw !== "object") return { ...d, gradient: { ...d.gradient } };
  const r = raw as Record<string, unknown>;
  const color = (v: unknown, fb: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fb);
  const pick = <T extends string>(v: unknown, list: readonly T[], fb: T): T => (list.includes(v as T) ? (v as T) : fb);
  const num = (v: unknown, min: number, max: number, fb: number) =>
    typeof v === "number" && isFinite(v) ? Math.min(max, Math.max(min, v)) : fb;
  const gr = (r.gradient && typeof r.gradient === "object" ? r.gradient : {}) as Record<string, unknown>;
  return {
    fg: color(r.fg, d.fg),
    bg: color(r.bg, d.bg),
    bgTransparent: r.bgTransparent === true,
    gradient: {
      enabled: gr.enabled === true,
      type: pick(gr.type, ["linear", "radial"] as const, "linear"),
      from: color(gr.from, d.gradient.from),
      to: color(gr.to, d.gradient.to),
      angle: num(gr.angle, 0, 360, 45),
    },
    dotStyle: pick(r.dotStyle, ["square", "rounded", "dots", "smallDots", "diamond", "classy", "vbars", "hbars"] as const, "square"),
    eyeFrameStyle: pick(r.eyeFrameStyle, ["square", "rounded", "circle", "leaf", "octagon"] as const, "square"),
    eyeBallStyle: pick(r.eyeBallStyle, ["square", "rounded", "circle", "diamond", "leaf"] as const, "square"),
    eyeFrameColor: typeof r.eyeFrameColor === "string" ? color(r.eyeFrameColor, d.fg) : null,
    eyeBallColor: typeof r.eyeBallColor === "string" ? color(r.eyeBallColor, d.fg) : null,
    logoId: typeof r.logoId === "number" && (r.logoId > 0 || BUILTIN_LOGOS[r.logoId]) ? r.logoId : null,
    logoSize: num(r.logoSize, 8, 30, 20),
    logoPadding: num(r.logoPadding, 0, 3, 1),
    logoShape: r.logoShape === "circle" ? "circle" : "square",
    logoBg: color(r.logoBg, "#ffffff"),
    frameStyle: pick(r.frameStyle, ["none", "text", "border", "banner", "pill"] as const, "none"),
    frameColor: color(r.frameColor, d.frameColor),
    frameText: typeof r.frameText === "string" ? r.frameText.slice(0, 40) : "",
    frameTextPos: r.frameTextPos === "top" ? "top" : "bottom",
    frameTextColor: color(r.frameTextColor, d.frameTextColor),
    frameFont: pick(r.frameFont, ["sans", "serif", "mono", "rounded"] as const, "sans"),
    frameFontScale: num(r.frameFontScale, 0.6, 1.6, 1),
    ecc: pick(r.ecc, ["L", "M", "Q", "H"] as const, "M"),
    margin: Math.round(num(r.margin, 0, 10, 4)),
    size: Math.round(num(r.size, 128, 4096, 1024)),
  };
}
