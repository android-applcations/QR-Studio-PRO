/** Core shared types for QR Studio Pro */

export type Lang = "ar" | "en";
export type ThemeMode = "dark" | "light" | "system";
/** Bilingual text tuple: [English, Arabic] */
export type Tx = readonly [string, string];

export type EccLevel = "L" | "M" | "Q" | "H";
export type DotStyle = "square" | "rounded" | "dots" | "smallDots" | "diamond" | "classy" | "vbars" | "hbars";
export type EyeFrameStyle = "square" | "rounded" | "circle" | "leaf" | "octagon";
export type EyeBallStyle = "square" | "rounded" | "circle" | "diamond" | "leaf";
export type FrameStyle = "none" | "text" | "border" | "banner" | "pill";
export type FontFamilyKey = "sans" | "serif" | "mono" | "rounded";

export interface GradientConfig {
  enabled: boolean;
  type: "linear" | "radial";
  from: string;
  to: string;
  angle: number;
}

export interface DesignConfig {
  fg: string;
  bg: string;
  bgTransparent: boolean;
  gradient: GradientConfig;
  dotStyle: DotStyle;
  eyeFrameStyle: EyeFrameStyle;
  eyeBallStyle: EyeBallStyle;
  eyeFrameColor: string | null;
  eyeBallColor: string | null;
  logoId: number | null;
  /** Logo width as percent of QR width (8-30) */
  logoSize: number;
  /** Clear area padding around the logo in modules (0-3) */
  logoPadding: number;
  logoShape: "square" | "circle";
  logoBg: string;
  frameStyle: FrameStyle;
  frameColor: string;
  frameText: string;
  frameTextPos: "top" | "bottom";
  frameTextColor: string;
  frameFont: FontFamilyKey;
  frameFontScale: number;
  ecc: EccLevel;
  /** Quiet zone in modules (0-10) */
  margin: number;
  /** Default output size in px */
  size: number;
}

export type FieldKind = "text" | "url" | "tel" | "email" | "textarea" | "select" | "password" | "number" | "datetime" | "checkbox";

export interface FieldDef {
  key: string;
  kind: FieldKind;
  label: Tx;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: Tx }[];
  maxLength?: number;
  prefix?: string;
  hint?: Tx;
  defaultValue?: string;
  half?: boolean;
  dir?: "ltr" | "auto";
  /** Only shown (and validated) when values[key] is one of the list */
  showIf?: [string, string[]];
}

export type QrCategoryId =
  | "social"
  | "links"
  | "business"
  | "telecom"
  | "network"
  | "personal"
  | "payment"
  | "media";

export type FormValues = Record<string, string>;

export interface QrTypeDef {
  id: string;
  category: QrCategoryId | "hidden";
  title: Tx;
  desc: Tx;
  /** Brand icon key (simple-icons) or lucide key */
  icon: string;
  fields: FieldDef[];
  /** Returns payload or throws nothing; validation happens in `validate` */
  build: (v: FormValues) => string;
  validate: (v: FormValues) => Record<string, Tx>;
  /** Sensitive content is never logged with its content */
  sensitive?: boolean;
}

export interface QrRecord {
  id?: number;
  uid: string;
  name: string;
  description: string;
  content: string;
  type: string;
  form_values: FormValues;
  design_config: DesignConfig;
  created_at: number;
  updated_at: number;
  favorite: 0 | 1;
  category: string;
  batchId?: number | null;
}

export interface HistoryRecord {
  id?: number;
  content: string;
  type: string;
  scanned_at: number;
  action: "scan" | "create" | "export" | "save";
  name?: string;
}

export interface TemplateRecord {
  id?: number;
  uid: string;
  name: string;
  design_config: DesignConfig;
  created_at: number;
}

export interface CategoryRecord {
  id?: number;
  name: string;
  created_at: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface BatchRecord {
  id?: number;
  name: string;
  created_at: number;
  items_count: number;
}

export interface AssetRecord {
  id?: number;
  blob: Blob;
  created_at: number;
}

export type SectionId = "create" | "design" | "scan" | "library" | "history" | "templates";

export interface Project {
  typeId: string;
  values: FormValues;
  design: DesignConfig;
  name: string;
  savedId: number | null;
}
