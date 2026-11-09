import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Frame, ImagePlus, Palette, Redo2, RotateCcw, Shapes, SlidersHorizontal, Star, Trash2, Undo2, Upload } from "lucide-react";
import type { DesignConfig, DotStyle, EccLevel, EyeBallStyle, EyeFrameStyle, FontFamilyKey, FrameStyle } from "../core/types";
import { DEFAULT_DESIGN } from "../core/designDefaults";
import { T } from "../core/i18n";
import { useApp } from "../state/AppContext";
import { useProjectActions, useProjectLogo, useProjectSlice, useProjectStore } from "../state/ProjectContext";
import { renderQrSvg, svgToDataUrl } from "../engine/designEngine";
import { addTemplate } from "../db/db";
import { cn } from "../utils/cn";
import { QrImage, ReadabilityPanel, useReadability } from "./QrView";
import { Button, ColorField, Field, IconBtn, inputCls, Modal, Segmented, Slider, Toggle } from "./ui";
import { ExportSheet } from "./ExportSheet";
import { PrintSheet } from "./PrintSheet";
import { buildContent, detailRows, TYPE_BY_ID } from "../core/qrTypes";

type Tab = "colors" | "shapes" | "logo" | "frame" | "tech";

const SAMPLE = "QR Studio Pro";

const StylePreview = memo(function StylePreview({ patch, active, label, onClick }: { patch: Partial<DesignConfig>; active: boolean; label: string; onClick: () => void }) {
  const url = useMemo(() => {
    const d: DesignConfig = { ...DEFAULT_DESIGN, ...patch, margin: 0, frameStyle: "none", ecc: "L" };
    return svgToDataUrl(renderQrSvg("QR", d).svg);
  }, [patch]);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn("press flex min-h-[78px] flex-col items-center gap-1 rounded-xl border p-2 text-[11px]", active ? "border-brand bg-brand/15 text-brand" : "border-line bg-surface2/50 text-muted hover:text-fg")}
    >
      <img src={url} alt="" className="h-11 w-11 rounded bg-white p-0.5" draggable={false} />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
});

const COLOR_PRESETS: [string, string][] = [
  ["#0b0f19", "#ffffff"], ["#1e3a8a", "#ffffff"], ["#065f46", "#ffffff"], ["#7f1d1d", "#ffffff"],
  ["#4c1d95", "#ffffff"], ["#111827", "#fde68a"], ["#0f172a", "#e0f2fe"], ["#831843", "#fce7f3"],
];

const DOT_STYLES: [DotStyle, string, string][] = [
  ["square", "Square", "مربعات"], ["rounded", "Rounded", "مستديرة"], ["dots", "Dots", "دوائر"], ["smallDots", "Small dots", "نقاط صغيرة"],
  ["diamond", "Diamond", "معين"], ["classy", "Classy", "أنيق"], ["vbars", "Vertical", "عمودي"], ["hbars", "Horizontal", "أفقي"],
];
const EYE_FRAMES: [EyeFrameStyle, string, string][] = [
  ["square", "Square", "مربع"], ["rounded", "Rounded", "مستدير"], ["circle", "Circle", "دائرة"], ["leaf", "Leaf", "ورقة"], ["octagon", "Octagon", "مثمن"],
];
const EYE_BALLS: [EyeBallStyle, string, string][] = [
  ["square", "Square", "مربع"], ["rounded", "Rounded", "مستدير"], ["circle", "Circle", "دائرة"], ["diamond", "Diamond", "معين"], ["leaf", "Leaf", "ورقة"],
];
const FRAMES: [FrameStyle, string, string][] = [
  ["none", "None", "بدون"], ["text", "Text only", "نص فقط"], ["border", "Border", "حدود"], ["banner", "Banner", "شريط"], ["pill", "Pill", "كبسولة"],
];
const FONTS: [FontFamilyKey, string, string][] = [["sans", "Modern", "عصري"], ["serif", "Classic", "كلاسيكي"], ["mono", "Mono", "ثابت"], ["rounded", "Rounded", "مستدير"]];
const ECC_INFO: Record<EccLevel, [string, string]> = { L: ["7% recovery · smallest", "استرجاع 7% · الأصغر"], M: ["15% recovery · balanced", "استرجاع 15% · متوازن"], Q: ["25% recovery · good with logos", "استرجاع 25% · جيد مع الشعار"], H: ["30% recovery · best with logos", "استرجاع 30% · الأفضل مع الشعار"] };

/**
 * Controls that read one field each.
 *
 * The design editor is the one screen where state changes faster than a person
 * can see, and a control that subscribes to the whole design gets rebuilt when
 * an unrelated field moves — forty colour changes rebuilt every slider on the
 * screen forty times. Each of these reads the single field it shows and writes
 * it back, so changing the dot colour touches the dot-colour control and
 * nothing else. The rest of the panel sits still.
 *
 * Handlers that need to know a *second* field read it from the store when the
 * click happens (`useProjectStore`) instead of subscribing to it.
 */

/** The value of one design field, plus a writer for it. */
function useField<K extends keyof DesignConfig>(key: K): [DesignConfig[K], (patch: Partial<DesignConfig>, coalesce?: string) => void] {
  const value = useProjectSlice((s) => s.project.design[key]);
  const { setDesign } = useProjectActions();
  const set = useCallback((patch: Partial<DesignConfig>, coalesce?: string) => setDesign(patch, coalesce), [setDesign]);
  return [value, set];
}

function DesignColor({
  field, label, coalesce, patch,
}: {
  field: keyof DesignConfig;
  label: string;
  coalesce?: string;
  /** write more than one field: receives the new value and the whole design */
  patch?: (v: string, d: DesignConfig) => Partial<DesignConfig>;
}) {
  const [value, set] = useField(field);
  const store = useProjectStore();
  return (
    <ColorField
      label={label}
      value={value as string}
      onChange={(v) => set(patch ? patch(v, store.get().project.design) : ({ [field]: v } as Partial<DesignConfig>), coalesce)}
    />
  );
}

function DesignSlider({
  field, label, min, max, step, suffix, coalesce,
}: {
  field: keyof DesignConfig;
  label: string;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  coalesce?: string;
}) {
  const [value, set] = useField(field);
  return <Slider label={label} value={value as number} min={min} max={max} step={step} onChange={(v) => set({ [field]: v } as Partial<DesignConfig>, coalesce)} suffix={suffix} />;
}

function DesignToggle({
  field, label, desc, patch,
}: {
  field: keyof DesignConfig;
  label: string;
  desc?: string;
  patch?: (on: boolean, d: DesignConfig) => Partial<DesignConfig>;
}) {
  const [checked, set] = useField(field);
  const store = useProjectStore();
  return <Toggle checked={checked as boolean} onChange={(v) => set(patch ? patch(v, store.get().project.design) : ({ [field]: v } as Partial<DesignConfig>))} label={label} desc={desc} />;
}

function DesignSegmented<T extends string>({ field, label, options }: { field: keyof DesignConfig; label: string; options: { value: T; label: string }[] }) {
  const [value, set] = useField(field);
  return <Segmented value={value as T} onChange={(v) => set({ [field]: v } as Partial<DesignConfig>)} label={label} options={options} />;
}

/** A grid of style choices for one field. Re-renders when that field moves. */
function StyleGrid<K extends keyof DesignConfig>({ field, choices, title, onPick }: {
  field: K;
  choices: readonly [DesignConfig[K] & string, string, string][];
  title: string;
  onPick?: (v: DesignConfig[K] & string, d: DesignConfig) => Partial<DesignConfig>;
}) {
  const { t } = useApp();
  const [active, set] = useField(field);
  const store = useProjectStore();
  return (
    <div className="card p-4">
      <p className="mb-2 text-[13px] font-medium text-muted">{title}</p>
      <div className={cn("grid gap-2", choices.length > 5 ? "grid-cols-5" : "grid-cols-4")}>
        {choices.map(([v, en, ar]) => (
          <StylePreview
            key={v}
            patch={stablePatch({ [field]: v } as Partial<DesignConfig>)}
            active={active === v}
            label={t([en, ar])}
            onClick={() => set(onPick ? onPick(v, store.get().project.design) : ({ [field]: v } as Partial<DesignConfig>))}
          />
        ))}
      </div>
    </div>
  );
}

/** The gradient block: subscribes to the gradient object, not to the design. */
function GradientBox() {
  const { t } = useApp();
  const [grad, set] = useField("gradient");
  const g = grad as DesignConfig["gradient"];
  return (
    <div className="card space-y-3 p-4">
      <DesignToggle field="gradient" label={t(["Gradient", "تدرج لوني"])} patch={(on, d) => ({ gradient: { ...d.gradient, enabled: on } })} />
      {g.enabled && (
        <div className="anim-fade-in space-y-3">
          <Segmented value={g.type} onChange={(v) => set({ gradient: { ...g, type: v } })} label="gradient" options={[{ value: "linear", label: t(["Linear", "خطي"]) }, { value: "radial", label: t(["Radial", "دائري"]) }]} />
          <ColorField label={t(["From", "من"])} value={g.from} onChange={(v) => set({ gradient: { ...g, from: v } }, "g1")} />
          <ColorField label={t(["To", "إلى"])} value={g.to} onChange={(v) => set({ gradient: { ...g, to: v } }, "g2")} />
          {g.type === "linear" && <Slider label={t(["Angle", "الزاوية"])} value={g.angle} min={0} max={360} onChange={(v) => set({ gradient: { ...g, angle: v } }, "ga")} suffix="°" />}
        </div>
      )}
    </div>
  );
}

/** Corner colours, shown only once they are switched on. */
function CornerColors() {
  const { t } = useApp();
  const [frameColor, set] = useField("eyeFrameColor");
  const [ballColor] = useField("eyeBallColor");
  const [fg] = useField("fg");
  const on = frameColor != null;
  return (
    <div className="card space-y-3 p-4">
      <Toggle
        checked={on}
        onChange={(v) => set(v ? { eyeFrameColor: fg as string, eyeBallColor: fg as string } : { eyeFrameColor: null, eyeBallColor: null })}
        label={t(["Custom corner colors", "ألوان مخصصة للزوايا"])}
      />
      {on && (
        <div className="anim-fade-in space-y-3">
          <ColorField label={t(["Corner frame", "إطار الزاوية"])} value={frameColor as string} onChange={(v) => set({ eyeFrameColor: v }, "ef")} />
          <ColorField label={t(["Corner center", "مركز الزاوية"])} value={(ballColor ?? frameColor) as string} onChange={(v) => set({ eyeBallColor: v }, "eb")} />
        </div>
      )}
    </div>
  );
}

/** One ready-made palette. Reads the design only when it is clicked. */
const PaletteSwatch = memo(function PaletteSwatch({ fg, bg }: { fg: string; bg: string }) {
  const { setDesign } = useProjectActions();
  const store = useProjectStore();
  return (
    <button
      type="button"
      aria-label={`${fg} / ${bg}`}
      onClick={() => {
        const d = store.get().project.design;
        setDesign({
          fg,
          bg,
          bgTransparent: false,
          gradient: { ...d.gradient, enabled: false },
          frameColor: fg,
          frameTextColor: d.frameStyle === "banner" || d.frameStyle === "pill" ? d.frameTextColor : fg,
        });
      }}
      className="press h-11 w-11 overflow-hidden rounded-xl border border-line"
      style={{ background: `linear-gradient(135deg, ${fg} 50%, ${bg} 50%)` }}
    />
  );
});

function FrameStyleGrid() {
  const { t } = useApp();
  const [style, set] = useField("frameStyle");
  const store = useProjectStore();
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-muted">{t(["Frame style", "نمط الإطار"])}</p>
      <div className="grid grid-cols-5 gap-2">
        {FRAMES.map(([v, en, ar]) => (
          <button
            key={v}
            type="button"
            aria-pressed={style === v}
            onClick={() => {
              const cur = store.get().project.design;
              set({ frameStyle: v, frameText: cur.frameText || (v !== "none" ? t(["SCAN ME", "امسحني"]) : "") });
            }}
            className={cn("press min-h-12 rounded-xl border px-1 text-[12px]", style === v ? "border-brand bg-brand/15 text-brand" : "border-line bg-surface2/50 text-muted")}
          >
            {t([en, ar])}
          </button>
        ))}
      </div>
    </div>
  );
}

function FrameDetails() {
  const { t } = useApp();
  const [style] = useField("frameStyle");
  const [text, set] = useField("frameText");
  const [font, setFont] = useField("frameFont");
  if (style === "none") return null;
  return (
    <div className="anim-fade-in space-y-4">
      <Field label={t(["Caption", "العبارة"])}>
        <input className={inputCls()} value={text as string} maxLength={40} dir="auto" onChange={(e) => set({ frameText: e.target.value }, "ft")} placeholder={t(["SCAN ME", "امسحني"])} />
      </Field>
      <Field label={t(["Caption position", "موضع العبارة"])}>
        <DesignSegmented field="frameTextPos" label="position" options={[{ value: "top", label: t(["Above", "فوق"]) }, { value: "bottom", label: t(["Below", "تحت"]) }]} />
      </Field>
      <Field label={t(["Font", "الخط"])}>
        <div className="grid grid-cols-4 gap-2">
          {FONTS.map(([v, en, ar]) => (
            <button key={v} type="button" aria-pressed={font === v} onClick={() => setFont({ frameFont: v })} className={cn("press min-h-10 rounded-lg border px-1 text-[12px]", font === v ? "border-brand bg-brand/15 text-brand" : "border-line bg-surface2/50 text-muted")}>{t([en, ar])}</button>
          ))}
        </div>
      </Field>
      <DesignSlider field="frameFontScale" label={t(["Text size", "حجم النص"])} min={0.6} max={1.6} step={0.1} suffix="×" coalesce="fs" />
      {style !== "text" && <DesignColor field="frameColor" label={t(["Frame color", "لون الإطار"])} coalesce="fc" />}
      <DesignColor field="frameTextColor" label={t(["Text color", "لون النص"])} coalesce="ftc" />
    </div>
  );
}

function EccField() {
  const { t } = useApp();
  const [ecc, set] = useField("ecc");
  return (
    <Field label={t(["Error correction level", "مستوى تصحيح الأخطاء"])} hint={t(ECC_INFO[ecc as EccLevel] as [string, string])}>
      <Segmented value={ecc as EccLevel} onChange={(v) => set({ ecc: v })} label="ecc" options={(["L", "M", "Q", "H"] as EccLevel[]).map((v) => ({ value: v, label: v }))} />
    </Field>
  );
}

/**
 * The preview column: the only part of this screen that has to follow every
 * change, and the only part allowed to.
 *
 * `useDeferredValue` is what keeps a drag smooth. The controls keep their own
 * value and respond immediately; this redraws at a lower priority, so two
 * changes inside one frame produce one drawing instead of two.
 */
function Preview({
  content, logoHref, isSample, name, typeId, onSaveTemplate,
}: {
  content: string;
  logoHref: string | null;
  isSample: boolean;
  name: string;
  typeId: string;
  onSaveTemplate: () => void;
}) {
  const { t, go } = useApp();
  const { setDesign, undo, redo, resetDesign } = useProjectActions();
  const canUndo = useProjectSlice((s) => s.past.length > 0);
  const canRedo = useProjectSlice((s) => s.future.length > 0);
  const design = useProjectSlice((s) => s.project.design);
  const shown = useDeferredValue(design);
  const rd = useReadability(content, shown, logoHref);
  const store = useProjectStore();
  const [showExport, setShowExport] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  // Captured when the sheet opens rather than subscribed to: an open dialog
  // must not be rebuilt under the finger, and what you export is what you saw.
  const [frozen, setFrozen] = useState<{ design: DesignConfig; details: { label: string; value: string }[] } | null>(null);

  return (
    <div className="shrink-0 border-b border-line px-3 pb-2 pt-3 md:w-[340px] md:overflow-y-auto md:border-b-0 md:border-e md:px-4 lg:w-[380px] scroll-area">
      <div className="mb-2 flex items-center gap-1">
        <h2 className="me-auto text-[17px] font-bold">{t(T.design)}</h2>
        <IconBtn label={t(T.undo)} onClick={undo} disabled={!canUndo}><Undo2 size={20} /></IconBtn>
        <IconBtn label={t(T.redo)} onClick={redo} disabled={!canRedo}><Redo2 size={20} /></IconBtn>
        <IconBtn label={t(["Restore default design", "استعادة التصميم الافتراضي"])} onClick={resetDesign}><RotateCcw size={19} /></IconBtn>
      </div>
      <div className="flex items-start gap-3 md:flex-col md:items-stretch">
        <div className="w-[34vw] max-w-[170px] shrink-0 rounded-2xl bg-white p-1.5 shadow-lg md:mx-auto md:w-full md:max-w-[300px]">
          <QrImage content={content} design={shown} logoHref={logoHref} className="w-full" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {isSample && <p className="text-[11px] leading-4 text-muted">{t(["Sample preview — enter your data in Create to design your real code.", "معاينة تجريبية — أدخل بياناتك في «إنشاء» لتصميم رمزك الفعلي."])}</p>}
          <div className="hidden md:block"><ReadabilityPanel status={rd.status} issues={rd.issues} onFix={(p) => setDesign(p)} /></div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={isSample}
              onClick={() => {
                const cur = store.get().project;
                setFrozen({
                  design: cur.design,
                  details: detailRows(TYPE_BY_ID[cur.typeId] ?? TYPE_BY_ID.url, cur.values).map((r) => ({ label: t(r.label), value: r.valueTx ? t(r.valueTx) : r.value })),
                });
                setShowExport(true);
              }}
              icon={<Download size={16} />}
            >
              {t(T.export)}
            </Button>
            <Button size="sm" onClick={onSaveTemplate} icon={<Star size={16} />}>{t(["Save as template", "حفظ كقالب"])}</Button>
            {isSample && <Button size="sm" variant="ghost" onClick={() => go("create")}>{t(T.create)}</Button>}
          </div>
          {/* compact readability on phones */}
          <div className="md:hidden">
            <ReadabilityPanel status={rd.status} issues={rd.issues.slice(0, 1)} onFix={(p) => setDesign(p)} compact />
          </div>
        </div>
      </div>
      {frozen && (
        <>
          <ExportSheet open={showExport} onClose={() => setShowExport(false)} items={[{ content, design: frozen.design, logoHref, name, type: typeId }]} onPrint={() => { setShowExport(false); setShowPrint(true); }} />
          <PrintSheet open={showPrint} onClose={() => setShowPrint(false)} items={[{ content, design: frozen.design, logoHref, label: name, details: frozen.details }]} />
        </>
      )}
    </div>
  );
}

/**
 * The readability note on the logo tab.
 *
 * It asks the same question the preview asks, and `verifyDesign` answers it
 * once for both — so this can keep its own subscription without doubling the
 * cost, and the rest of the tab is not rebuilt while a colour is dragged.
 */
function LogoReadability({ content }: { content: string }) {
  const { setDesign } = useProjectActions();
  const logoHref = useProjectLogo();
  const design = useProjectSlice((s) => s.project.design);
  const shown = useDeferredValue(design);
  const rd = useReadability(content, shown, logoHref);
  return <ReadabilityPanel status={rd.status} issues={rd.issues.filter((i) => i.fix?.ecc || i.fix?.logoSize)} onFix={(p) => setDesign(p)} compact />;
}

export default function DesignEditor() {
  const { t, toast, fail } = useApp();
  // Deliberately not subscribed to the design: this screen holds the controls
  // and the preview, and each of those follows the design on its own. Moving a
  // slider therefore redraws the control being moved and the preview — not the
  // whole editor around them.
  const { undo, redo, uploadLogo, removeLogo } = useProjectActions();
  const store = useProjectStore();
  const canUndo = useProjectSlice((s) => s.past.length > 0);
  const canRedo = useProjectSlice((s) => s.future.length > 0);
  const meta = useProjectSlice((s) => ({ name: s.project.name, typeId: s.project.typeId, values: s.project.values }));
  const logoHref = useProjectLogo();
  const type = TYPE_BY_ID[meta.typeId] ?? TYPE_BY_ID.url;
  const build = useMemo(() => buildContent(type, meta.values), [type, meta.values]);
  const [tab, setTab] = useState<Tab>("colors");
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const isSample = !build.valid;
  const content = build.valid ? build.content : SAMPLE;

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "colors", label: t(["Colors", "الألوان"]), icon: <Palette size={17} /> },
    { id: "shapes", label: t(["Shapes", "الأشكال"]), icon: <Shapes size={17} /> },
    { id: "logo", label: t(["Logo", "الشعار"]), icon: <ImagePlus size={17} /> },
    { id: "frame", label: t(["Frame", "الإطار"]), icon: <Frame size={17} /> },
    { id: "tech", label: t(["Technical", "تقني"]), icon: <SlidersHorizontal size={17} /> },
  ];

  const saveTemplate = async () => {
    const name = tplName.trim();
    if (!name) return;
    try {
      await addTemplate(name, store.get().project.design);
      toast(t(["Template saved", "تم حفظ القالب"]));
      setTplOpen(false);
      setTplName("");
    } catch (e) {
      fail(e);
    }
  };

  /*
   * Ctrl/Cmd+Z and Ctrl+Y (or Ctrl+Shift+Z) are the shortcuts every editor has
   * taught people, so the buttons in the header are not the only way back.
   * Skipped while a text field has focus, where they mean "undo my typing".
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = document.activeElement;
      const typing =
        !!el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        if (!canUndo) return;
        e.preventDefault();
        undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        if (!canRedo) return;
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, canUndo, canRedo]);

  const name = meta.name || t(type.title);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <Preview content={content} logoHref={logoHref} isSample={isSample} name={name} typeId={meta.typeId} onSaveTemplate={() => setTplOpen(true)} />
      {/* Controls */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Wraps on phones so every tab stays on screen instead of running off the edge. */}
        <div className="flex min-w-0 shrink-0 flex-wrap gap-1.5 px-3 py-2" role="tablist" aria-label={t(T.design)}>
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} className={cn("press flex min-h-10 max-w-full items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium", tab === x.id ? "border-brand bg-brand/15 text-brand" : "border-line bg-surface2/60 text-muted hover:text-fg")}>
              {x.icon}{x.label}
            </button>
          ))}
        </div>

        <div className="scroll-area min-h-0 flex-1 px-3 pb-5 md:px-4">
          <div key={tab} className="anim-fade-up mx-auto max-w-2xl space-y-4">
            {tab === "colors" && (
              <>
                <div className="card space-y-3 p-4">
                  <DesignColor
                    field="fg"
                    label={t(["Dots color", "لون النقاط"])}
                    coalesce="fg"
                    patch={(v, d) => ({ fg: v, frameColor: d.frameStyle !== "none" && d.frameColor === d.fg ? v : d.frameColor, frameTextColor: d.frameTextColor === d.fg ? v : d.frameTextColor })}
                  />
                  <DesignColor field="bg" label={t(["Background color", "لون الخلفية"])} coalesce="bg" />
                  <DesignToggle field="bgTransparent" label={t(["Transparent background", "خلفية شفافة"])} desc={t(["Applied to PNG and SVG exports", "تُطبق على تصدير PNG وSVG"])} />
                </div>
                <div className="card space-y-3 p-4">
                  <GradientBox />
                </div>
                <div className="card space-y-3 p-4">
                  <CornerColors />
                </div>
                <div className="card p-4">
                  <p className="mb-2 text-[13px] font-medium text-muted">{t(["Quick palettes", "ألوان جاهزة"])}</p>
                  <div className="flex flex-wrap gap-2">
                    {COLOR_PRESETS.map(([fg, bg]) => (
                      <PaletteSwatch key={fg + bg} fg={fg} bg={bg} />
                    ))}
                  </div>
                </div>
              </>
            )}

            {tab === "shapes" && (
              <>
                <StyleGrid field="dotStyle" choices={DOT_STYLES} title={t(["Dot shape", "شكل النقاط"])} />
                <StyleGrid field="eyeFrameStyle" choices={EYE_FRAMES} title={t(["Corner frame shape", "شكل إطار الزوايا"])} />
                <StyleGrid field="eyeBallStyle" choices={EYE_BALLS} title={t(["Corner center shape", "شكل مركز الزوايا"])} />
              </>
            )}

            {tab === "logo" && (
              <div className="card space-y-4 p-4">
                <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }} />
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
                    {logoHref ? <img src={logoHref} alt={t(["Logo", "الشعار"])} className="h-full w-full object-contain" /> : <ImagePlus className="text-zinc-400" />}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" onClick={() => fileRef.current?.click()} icon={<Upload size={17} />}>{logoHref ? t(["Replace", "استبدال"]) : t(["Upload logo", "رفع شعار"])}</Button>
                    {logoHref && <Button variant="danger" onClick={removeLogo} icon={<Trash2 size={17} />}>{t(["Remove", "إزالة"])}</Button>}
                  </div>
                </div>
                {logoHref ? (
                  <>
                    <DesignSlider field="logoSize" label={t(["Logo size", "حجم الشعار"])} min={8} max={30} suffix="%" coalesce="ls" />
                    <DesignSlider field="logoPadding" label={t(["Clear space around logo", "المساحة المحيطة بالشعار"])} min={0} max={3} step={0.5} coalesce="lp" />
                    <Field label={t(["Logo shape", "شكل الشعار"])}>
                      <DesignSegmented field="logoShape" label="logo shape" options={[{ value: "square", label: t(["Square", "مربع"]) }, { value: "circle", label: t(["Circle", "دائرة"]) }]} />
                    </Field>
                    <DesignColor field="logoBg" label={t(["Logo backdrop", "خلفية الشعار"])} coalesce="lb" />
                    <LogoReadability content={content} />
                  </>
                ) : (
                  <p className="text-sm text-muted">{t(["Add a logo to place it in the center of the code. Large logos reduce readability, so use error-correction level Q or H.", "أضف شعاراً ليوضع في منتصف الرمز. الشعارات الكبيرة تقلل قابلية القراءة، لذا استخدم مستوى التصحيح Q أو H."])}</p>
                )}
              </div>
            )}

            {tab === "frame" && (
              <div className="card space-y-4 p-4">
                <FrameStyleGrid />
                <FrameDetails />
              </div>
            )}

            {tab === "tech" && (
              <div className="card space-y-4 p-4">
                <EccField />
                <DesignSlider field="margin" label={t(["Quiet zone (modules)", "المنطقة الهادئة (وحدات)"])} min={0} max={10} coalesce="mg" />
                <DesignSlider field="size" label={t(["Default export size", "حجم التصدير الافتراضي"])} min={256} max={4096} step={64} suffix=" px" coalesce="sz" />
                <p className="text-xs leading-5 text-muted">{t(["A quiet zone of at least 4 modules is recommended so scanners can find the code edges. Finder patterns are always preserved.", "يُوصى بمنطقة هادئة لا تقل عن 4 وحدات ليتمكن الماسح من تحديد حواف الرمز. أنماط التحديد محفوظة دائماً."])}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={tplOpen} onClose={() => setTplOpen(false)} title={t(["Save as template", "حفظ كقالب"])} footer={<><Button variant="ghost" onClick={() => setTplOpen(false)}>{t(T.cancel)}</Button><Button variant="primary" disabled={!tplName.trim()} onClick={saveTemplate}>{t(T.save)}</Button></>}>
        <Field label={t(["Template name", "اسم القالب"])}>
          <input autoFocus className={inputCls()} value={tplName} onChange={(e) => setTplName(e.target.value)} maxLength={60} onKeyDown={(e) => { if (e.key === "Enter") void saveTemplate(); }} />
        </Field>
        <p className="mt-2 text-xs text-muted">{t(["Saves colors, shapes, logo, frame and technical settings.", "يحفظ الألوان والأشكال والشعار والإطار والإعدادات التقنية."])}</p>
      </Modal>
    </div>
  );
}

const patchCache = new Map<string, Partial<DesignConfig>>();
/** Stable object identity per patch so memoized previews don't re-render. */
function stablePatch(p: Partial<DesignConfig>): Partial<DesignConfig> {
  const k = JSON.stringify(p);
  let v = patchCache.get(k);
  if (!v) {
    v = p;
    patchCache.set(k, v);
  }
  return v;
}
