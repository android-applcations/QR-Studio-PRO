import qrcode from "qrcode-generator";
import type { DesignConfig, EccLevel, FontFamilyKey, Tx } from "../core/types";

// Encode text as UTF-8 so Arabic / Unicode content is read correctly by scanners.
const utf8 = new TextEncoder();
qrcode.stringToBytes = (str: string) => Array.from(utf8.encode(str));

export interface QrMatrix {
  size: number;
  version: number;
  dark: boolean[][];
}

const matrixCache = new Map<string, QrMatrix>();

export class QrCapacityError extends Error {
  constructor() {
    super("QR_CAPACITY");
    this.name = "QrCapacityError";
  }
}

export function makeMatrix(content: string, ecc: EccLevel): QrMatrix {
  const key = ecc + "|" + content;
  const hit = matrixCache.get(key);
  if (hit) return hit;
  try {
    const qr = qrcode(0, ecc);
    qr.addData(content, "Byte");
    qr.make();
    const size = qr.getModuleCount();
    const dark: boolean[][] = [];
    for (let r = 0; r < size; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < size; c++) row.push(qr.isDark(r, c));
      dark.push(row);
    }
    const m = { size, version: (size - 17) / 4, dark };
    if (matrixCache.size > 60) matrixCache.delete(matrixCache.keys().next().value as string);
    matrixCache.set(key, m);
    return m;
  } catch {
    throw new QrCapacityError();
  }
}

const C = 10; // module size in SVG units

const FONTS: Record<FontFamilyKey, { family: string; weight: number }> = {
  sans: { family: "system-ui,'Segoe UI',Roboto,'Noto Sans Arabic',Tahoma,Arial,sans-serif", weight: 700 },
  serif: { family: "Georgia,'Times New Roman','Noto Naskh Arabic',serif", weight: 700 },
  mono: { family: "ui-monospace,Menlo,Consolas,'Courier New',monospace", weight: 700 },
  rounded: { family: "'Trebuchet MS','Arial Rounded MT Bold',system-ui,'Noto Sans Arabic',sans-serif", weight: 800 },
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const n = (v: number) => Math.round(v * 100) / 100;

function rrect(x: number, y: number, w: number, h: number, tl: number, tr: number, br: number, bl: number): string {
  return (
    `M${n(x + tl)} ${n(y)}H${n(x + w - tr)}` +
    (tr ? `A${n(tr)} ${n(tr)} 0 0 1 ${n(x + w)} ${n(y + tr)}` : "") +
    `V${n(y + h - br)}` +
    (br ? `A${n(br)} ${n(br)} 0 0 1 ${n(x + w - br)} ${n(y + h)}` : "") +
    `H${n(x + bl)}` +
    (bl ? `A${n(bl)} ${n(bl)} 0 0 1 ${n(x)} ${n(y + h - bl)}` : "") +
    `V${n(y + tl)}` +
    (tl ? `A${n(tl)} ${n(tl)} 0 0 1 ${n(x + tl)} ${n(y)}` : "") +
    "Z"
  );
}

function circle(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

function diamond(cx: number, cy: number, r: number): string {
  return `M${n(cx)} ${n(cy - r)}L${n(cx + r)} ${n(cy)}L${n(cx)} ${n(cy + r)}L${n(cx - r)} ${n(cy)}Z`;
}

function octagon(x: number, y: number, s: number, cut: number): string {
  return `M${n(x + cut)} ${n(y)}H${n(x + s - cut)}L${n(x + s)} ${n(y + cut)}V${n(y + s - cut)}L${n(x + s - cut)} ${n(y + s)}H${n(x + cut)}L${n(x)} ${n(y + s - cut)}V${n(y + cut)}Z`;
}

function eyeFramePath(style: DesignConfig["eyeFrameStyle"], x: number, y: number): string {
  const o = 7 * C;
  const i = 5 * C;
  const ix = x + C;
  const iy = y + C;
  switch (style) {
    case "rounded":
      return rrect(x, y, o, o, 2.2 * C, 2.2 * C, 2.2 * C, 2.2 * C) + rrect(ix, iy, i, i, 1.2 * C, 1.2 * C, 1.2 * C, 1.2 * C);
    case "circle":
      return circle(x + o / 2, y + o / 2, o / 2) + circle(ix + i / 2, iy + i / 2, i / 2);
    case "leaf":
      return rrect(x, y, o, o, 3.2 * C, 0, 3.2 * C, 0) + rrect(ix, iy, i, i, 2.2 * C, 0, 2.2 * C, 0);
    case "octagon":
      return octagon(x, y, o, 2 * C) + octagon(ix, iy, i, 1.2 * C);
    default:
      return rrect(x, y, o, o, 0, 0, 0, 0) + rrect(ix, iy, i, i, 0, 0, 0, 0);
  }
}

function eyeBallPath(style: DesignConfig["eyeBallStyle"], x: number, y: number): string {
  const s = 3 * C;
  const bx = x + 2 * C;
  const by = y + 2 * C;
  switch (style) {
    case "rounded":
      return rrect(bx, by, s, s, C, C, C, C);
    case "circle":
      return circle(bx + s / 2, by + s / 2, s / 2);
    case "diamond":
      return diamond(bx + s / 2, by + s / 2, 1.9 * C);
    case "leaf":
      return rrect(bx, by, s, s, 1.5 * C, 0, 1.5 * C, 0);
    default:
      return rrect(bx, by, s, s, 0, 0, 0, 0);
  }
}

function dotPath(style: DesignConfig["dotStyle"], x: number, y: number, up: boolean, right: boolean, down: boolean, left: boolean): string {
  const h = C / 2;
  switch (style) {
    case "rounded": {
      const r = h;
      return rrect(x, y, C, C, !up && !left ? r : 0, !up && !right ? r : 0, !down && !right ? r : 0, !down && !left ? r : 0);
    }
    case "classy":
      return rrect(x, y, C, C, h, 0, h, 0);
    case "dots":
      return circle(x + h, y + h, h * 0.96);
    case "smallDots":
      return circle(x + h, y + h, C * 0.36);
    case "diamond":
      return diamond(x + h, y + h, h * 1.02);
    case "vbars": {
      const w = C * 0.72;
      const r = w / 2;
      return rrect(x + (C - w) / 2, y, w, C, up ? 0 : r, up ? 0 : r, down ? 0 : r, down ? 0 : r);
    }
    case "hbars": {
      const w = C * 0.72;
      const r = w / 2;
      return rrect(x, y + (C - w) / 2, C, w, left ? 0 : r, right ? 0 : r, right ? 0 : r, left ? 0 : r);
    }
    default:
      return `M${n(x)} ${n(y)}h${C}v${C}h${-C}Z`;
  }
}

export interface RenderOptions {
  /** Data URL of logo image; when null the logo is omitted */
  logoHref?: string | null;
  /** Include frame + caption (default true) */
  frame?: boolean;
  /** Force transparent background (PNG/SVG) or opaque (JPG/PDF) */
  transparent?: boolean;
}

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
  modules: number;
  version: number;
  logoCoverage: number;
}

const hasArabic = (s: string) => /[\u0600-\u06FF]/.test(s);

export function renderQrSvg(content: string, d: DesignConfig, opts: RenderOptions = {}): RenderResult {
  const m = makeMatrix(content, d.ecc);
  const N = m.size;
  const q = d.margin;
  const S = (N + 2 * q) * C;
  const off = q * C;
  const transparent = opts.transparent ?? d.bgTransparent;
  const useFrame = opts.frame !== false;
  const frameStyle = useFrame ? d.frameStyle : "none";
  const text = useFrame ? d.frameText.trim() : "";
  const hasText = frameStyle !== "none" && text.length > 0;
  const logo = opts.logoHref || null;

  // --- Frame layout ---
  const padK = frameStyle === "border" ? 0.05 : frameStyle === "banner" ? 0.06 : frameStyle === "pill" ? 0.05 : 0;
  const pad = S * padK;
  const font = FONTS[d.frameFont];
  let fs = S * 0.072 * d.frameFontScale;
  const W = S + 2 * pad;
  const approxCharW = hasArabic(text) ? 0.56 : 0.64;
  if (hasText) fs = Math.min(fs, (W * 0.84) / Math.max(1, text.length * approxCharW));
  const capH = hasText ? Math.max(fs * 2.4, S * 0.1) : 0;
  const H = S + 2 * pad + capH;
  const top = hasText && d.frameTextPos === "top";
  const qx = pad;
  const qy = pad + (top ? capH : 0);
  const capY = top ? pad : pad + S;

  // --- Logo geometry (in modules) ---
  // A logo is a hole punched in the data, and the hole is centered, so past a
  // certain size it starts eating the timing patterns that run through the
  // middle of the symbol — at which point no amount of error correction puts
  // the code back together. The cleared square is therefore held under a fifth
  // of the symbol no matter what the slider says. Nothing is said about it; the
  // logo simply stays the largest size that still scans.
  const LOGO_MAX_AREA = 0.2;
  const logoModules = logo ? Math.max(3, (N * d.logoSize) / 100) : 0;
  const clearModules = logo
    ? Math.min(logoModules + d.logoPadding * 2, Math.sqrt(LOGO_MAX_AREA * N * N))
    : 0;
  const half = clearModules / 2;
  const mid = N / 2;
  const coverage = logo ? Math.min(1, (clearModules * clearModules) / (N * N)) : 0;
  const circleClear = logo && d.logoShape === "circle";

  const inLogo = (r: number, c: number) => {
    if (!logo) return false;
    const cx = c + 0.5 - mid;
    const cy = r + 0.5 - mid;
    if (circleClear) return Math.hypot(cx, cy) <= half + 0.25;
    return Math.abs(cx) <= half + 0.01 && Math.abs(cy) <= half + 0.01;
  };

  const isEye = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7);

  // --- Dot paths ---
  const dk = (r: number, c: number) => r >= 0 && c >= 0 && r < N && c < N && m.dark[r][c] && !isEye(r, c) && !inLogo(r, c);
  const parts: string[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!m.dark[r][c] || isEye(r, c) || inLogo(r, c)) continue;
      parts.push(dotPath(d.dotStyle, off + c * C, off + r * C, dk(r - 1, c), dk(r, c + 1), dk(r + 1, c), dk(r, c - 1)));
    }
  }
  const dotsD = parts.join("");

  // --- Eyes ---
  const eyes: [number, number][] = [
    [off, off],
    [off + (N - 7) * C, off],
    [off, off + (N - 7) * C],
  ];

  // --- Fills ---
  const grad = d.gradient;
  const fillMain = grad.enabled ? "url(#qg)" : d.fg;
  const eyeFrameFill = d.eyeFrameColor ?? fillMain;
  const eyeBallFill = d.eyeBallColor ?? d.eyeFrameColor ?? fillMain;
  let defs = "";
  if (grad.enabled) {
    const gx = qx + off;
    const gy = qy + off;
    const gs = S - 2 * off;
    if (grad.type === "radial") {
      defs = `<radialGradient id="qg" gradientUnits="userSpaceOnUse" cx="${n(gx + gs / 2)}" cy="${n(gy + gs / 2)}" r="${n(gs * 0.72)}"><stop offset="0" stop-color="${grad.from}"/><stop offset="1" stop-color="${grad.to}"/></radialGradient>`;
    } else {
      const a = (grad.angle * Math.PI) / 180;
      const dx = Math.cos(a) / 2;
      const dy = Math.sin(a) / 2;
      defs = `<linearGradient id="qg" gradientUnits="userSpaceOnUse" x1="${n(gx + gs * (0.5 - dx))}" y1="${n(gy + gs * (0.5 - dy))}" x2="${n(gx + gs * (0.5 + dx))}" y2="${n(gy + gs * (0.5 + dy))}"><stop offset="0" stop-color="${grad.from}"/><stop offset="1" stop-color="${grad.to}"/></linearGradient>`;
    }
  }

  // --- Compose ---
  const out: string[] = [];
  const outerR = S * 0.06;
  const sw = S * 0.025;
  const bgFill = transparent ? "none" : d.bg;

  if (frameStyle === "banner") {
    out.push(`<rect width="${n(W)}" height="${n(H)}" rx="${n(outerR)}" fill="${d.frameColor}"/>`);
    out.push(`<rect x="${n(qx)}" y="${n(qy)}" width="${n(S)}" height="${n(S)}" rx="${n(outerR * 0.5)}" fill="${d.bg}"/>`);
  } else if (frameStyle === "border") {
    if (!transparent) out.push(`<rect width="${n(W)}" height="${n(H)}" rx="${n(outerR)}" fill="${bgFill}"/>`);
    out.push(`<rect x="${n(sw / 2)}" y="${n(sw / 2)}" width="${n(W - sw)}" height="${n(H - sw)}" rx="${n(outerR)}" fill="none" stroke="${d.frameColor}" stroke-width="${n(sw)}"/>`);
  } else if (frameStyle === "pill") {
    if (!transparent) out.push(`<rect width="${n(W)}" height="${n(H)}" fill="${bgFill}"/>`);
    out.push(`<rect x="${n(sw / 2)}" y="${n(top ? capH + sw / 2 : sw / 2)}" width="${n(W - sw)}" height="${n(S + 2 * pad - sw)}" rx="${n(outerR)}" fill="none" stroke="${d.frameColor}" stroke-width="${n(sw)}"/>`);
  } else if (!transparent) {
    out.push(`<rect width="${n(W)}" height="${n(H)}" fill="${bgFill}"/>`);
  }

  // QR block
  out.push(`<g transform="translate(${n(qx)} ${n(qy)})">`);
  if (!transparent && frameStyle !== "banner") out.push(`<rect width="${n(S)}" height="${n(S)}" fill="${d.bg}"/>`);
  if (dotsD) out.push(`<path d="${dotsD}" fill="${fillMain}"/>`);
  for (const [ex, ey] of eyes) {
    out.push(`<path d="${eyeFramePath(d.eyeFrameStyle, ex, ey)}" fill="${eyeFrameFill}" fill-rule="evenodd"/>`);
    out.push(`<path d="${eyeBallPath(d.eyeBallStyle, ex, ey)}" fill="${eyeBallFill}"/>`);
  }
  if (logo) {
    const lx = off + (mid - logoModules / 2) * C;
    const ly = lx;
    const ls = logoModules * C;
    const bx = off + (mid - half) * C;
    const bs = clearModules * C;
    if (d.logoPadding > 0) {
      out.push(
        circleClear
          ? `<circle cx="${n(off + mid * C)}" cy="${n(off + mid * C)}" r="${n(bs / 2)}" fill="${d.logoBg}"/>`
          : `<rect x="${n(bx)}" y="${n(bx)}" width="${n(bs)}" height="${n(bs)}" rx="${n(C * 0.6)}" fill="${d.logoBg}"/>`,
      );
    }
    const clip = circleClear
      ? `<clipPath id="lc"><circle cx="${n(lx + ls / 2)}" cy="${n(ly + ls / 2)}" r="${n(ls / 2)}"/></clipPath>`
      : `<clipPath id="lc"><rect x="${n(lx)}" y="${n(ly)}" width="${n(ls)}" height="${n(ls)}" rx="${n(C * 0.4)}"/></clipPath>`;
    out.push(clip);
    out.push(
      `<image href="${esc(logo)}" x="${n(lx)}" y="${n(ly)}" width="${n(ls)}" height="${n(ls)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#lc)"/>`,
    );
  }
  out.push("</g>");

  // Caption
  if (hasText) {
    const cy = capY + capH / 2;
    if (frameStyle === "pill") {
      const pw = Math.min(W * 0.92, text.length * fs * approxCharW + fs * 2.4);
      const ph = fs * 1.9;
      out.push(`<rect x="${n((W - pw) / 2)}" y="${n(cy - ph / 2)}" width="${n(pw)}" height="${n(ph)}" rx="${n(ph / 2)}" fill="${d.frameColor}"/>`);
    }
    const rtl = hasArabic(text);
    out.push(
      `<text x="${n(W / 2)}" y="${n(cy)}" text-anchor="middle" dominant-baseline="central" font-family="${esc(font.family)}" font-weight="${font.weight}" font-size="${n(fs)}"${rtl ? ' direction="rtl" unicode-bidi="plaintext"' : ""} fill="${d.frameTextColor}">${esc(text)}</text>`,
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" width="${n(W)}" height="${n(H)}" shape-rendering="geometricPrecision">${defs ? `<defs>${defs}</defs>` : ""}${out.join("")}</svg>`;
  return { svg, width: W, height: H, modules: N + 2 * q, version: m.version, logoCoverage: coverage };
}

export const svgToDataUrl = (svg: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

// ---------- Readability analysis ----------

export interface DesignIssue {
  level: "warn" | "error";
  text: Tx;
  fix?: Partial<DesignConfig>;
}

function lum(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const ECC_CAPACITY: Record<EccLevel, number> = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 };

export function analyzeDesign(d: DesignConfig, hasLogo: boolean, version?: number, coverage?: number): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const bg = d.bgTransparent ? "#ffffff" : d.bg;
  const fgs = d.gradient.enabled ? [d.gradient.from, d.gradient.to] : [d.fg];
  const worst = Math.min(...fgs.map((c) => contrastRatio(c, bg)));
  if (worst < 2.5) {
    issues.push({ level: "error", text: ["Contrast is far too low — most scanners will fail to read this code.", "التباين منخفض جداً — أغلب الماسحات لن تتمكن من قراءة هذا الرمز."], fix: { fg: "#0b0f19", bg: "#ffffff", bgTransparent: false, gradient: { ...d.gradient, enabled: false } } });
  } else if (worst < 4) {
    issues.push({ level: "warn", text: ["Low contrast between code and background; reading may be unreliable.", "التباين بين الرمز والخلفية منخفض؛ قد تكون القراءة غير موثوقة."] });
  }
  const darkest = Math.min(...fgs.map(lum));
  if (darkest > lum(bg) && worst >= 2.5) {
    issues.push({ level: "warn", text: ["Inverted colors (light code on dark background): many scanner apps cannot read it.", "ألوان معكوسة (رمز فاتح على خلفية داكنة): كثير من تطبيقات المسح لا تقرؤه."] });
  }
  if (d.bgTransparent) {
    issues.push({ level: "warn", text: ["Transparent background: readability depends on the surface it is placed on.", "الخلفية الشفافة: تعتمد القراءة على السطح الذي يوضع عليه الرمز."] });
  }
  if (d.margin < 4) {
    issues.push({ level: d.margin < 2 ? "error" : "warn", text: ["Quiet zone is smaller than the recommended 4 modules.", "المنطقة الهادئة أصغر من الموصى به (4 وحدات)."], fix: { margin: 4 } });
  }
  if (hasLogo) {
    const cov = coverage ?? 0;
    const cap = ECC_CAPACITY[d.ecc];
    if (cov > cap * 1.0) {
      issues.push({ level: "error", text: ["The logo covers more than the error correction can recover — the code will likely not scan.", "الشعار يغطي أكثر مما يستطيع تصحيح الأخطاء استرجاعه — الأرجح أن الرمز لن يُقرأ."], fix: { ecc: "H", logoSize: Math.min(d.logoSize, 18) } });
    } else if (cov > cap * 0.6 || d.ecc === "L") {
      issues.push({ level: "warn", text: ["A large logo with this error-correction level reduces reliability. Level H is recommended.", "الشعار الكبير مع مستوى التصحيح الحالي يقلل الموثوقية. يُوصى بالمستوى H."], fix: { ecc: "H" } });
    }
  }
  if (version && version >= 12 && d.size < 600) {
    issues.push({ level: "warn", text: ["Dense code (long content): use a larger size when printing.", "رمز كثيف (محتوى طويل): استخدم حجماً أكبر عند الطباعة."] });
  }
  return issues;
}
