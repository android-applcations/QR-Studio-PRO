import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Frame, ImagePlus, Palette, Redo2, RotateCcw, Shapes, SlidersHorizontal, Star, Trash2, Undo2, Upload } from "lucide-react";
import type { DesignConfig, DotStyle, EccLevel, EyeBallStyle, EyeFrameStyle, FontFamilyKey, FrameStyle } from "../core/types";
import { DEFAULT_DESIGN } from "../core/designDefaults";
import { T } from "../core/i18n";
import { useApp } from "../state/AppContext";
import { useProject } from "../state/ProjectContext";
import { renderQrSvg, svgToDataUrl } from "../engine/designEngine";
import { addTemplate } from "../db/db";
import { cn } from "../utils/cn";
import { QrImage, ReadabilityPanel, useReadability } from "./QrView";
import { Button, ColorField, Field, IconBtn, inputCls, Modal, Segmented, Slider, Toggle } from "./ui";
import { ExportSheet } from "./ExportSheet";
import { PrintSheet } from "./PrintSheet";
import { detailRows } from "../core/qrTypes";

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

export default function DesignEditor() {
  const { t, go, toast, fail } = useApp();
  const { project, build, logoHref, setDesign, resetDesign, undo, redo, canUndo, canRedo, uploadLogo, removeLogo, type } = useProject();
  const d = project.design;
  const [tab, setTab] = useState<Tab>("colors");
  const [showExport, setShowExport] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // The details that travel with the code on the printed sheet.
  const sheetDetails = useMemo(
    () =>
      detailRows(type, project.values).map((r) => ({
        label: t(r.label),
        value: r.valueTx ? t(r.valueTx) : r.value,
      })),
    [type, project.values, t],
  );

  const isSample = !build.valid;
  const content = build.valid ? build.content : SAMPLE;
  const rd = useReadability(content, d, logoHref);

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
      await addTemplate(name, d);
      toast(t(["Template saved", "تم حفظ القالب"]));
      setTplOpen(false);
      setTplName("");
    } catch (e) {
      fail(e);
    }
  };

  const exportItem = { content, design: d, logoHref, name: project.name || t(type.title), type: project.typeId };
  const grad = d.gradient;

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* Preview column */}
      <div className="shrink-0 border-b border-line px-3 pb-2 pt-3 md:w-[340px] md:overflow-y-auto md:border-b-0 md:border-e md:px-4 lg:w-[380px] scroll-area">
        <div className="mb-2 flex items-center gap-1">
          <h2 className="me-auto text-[17px] font-bold">{t(T.design)}</h2>
          <IconBtn label={t(T.undo)} onClick={undo} disabled={!canUndo}><Undo2 size={20} /></IconBtn>
          <IconBtn label={t(T.redo)} onClick={redo} disabled={!canRedo}><Redo2 size={20} /></IconBtn>
          <IconBtn label={t(["Restore default design", "استعادة التصميم الافتراضي"])} onClick={resetDesign}><RotateCcw size={19} /></IconBtn>
        </div>
        <div className="flex items-start gap-3 md:flex-col md:items-stretch">
          <div className="w-[34vw] max-w-[170px] shrink-0 rounded-2xl bg-white p-1.5 shadow-lg md:mx-auto md:w-full md:max-w-[300px]">
            <QrImage content={content} design={d} logoHref={logoHref} className="w-full" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            {isSample && <p className="text-[11px] leading-4 text-muted">{t(["Sample preview — enter your data in Create to design your real code.", "معاينة تجريبية — أدخل بياناتك في «إنشاء» لتصميم رمزك الفعلي."])}</p>}
            <div className="hidden md:block"><ReadabilityPanel status={rd.status} issues={rd.issues} onFix={(p) => setDesign(p)} /></div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" disabled={isSample} onClick={() => setShowExport(true)} icon={<Download size={16} />}>{t(T.export)}</Button>
              <Button size="sm" onClick={() => setTplOpen(true)} icon={<Star size={16} />}>{t(["Save as template", "حفظ كقالب"])}</Button>
              {isSample && <Button size="sm" variant="ghost" onClick={() => go("create")}>{t(T.create)}</Button>}
            </div>
            {/* compact readability on phones */}
            <div className="md:hidden">
              <ReadabilityPanel status={rd.status} issues={rd.issues.slice(0, 1)} onFix={(p) => setDesign(p)} compact />
            </div>
          </div>
        </div>
      </div>

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
                  <ColorField label={t(["Dots color", "لون النقاط"])} value={d.fg} onChange={(v) => setDesign({ fg: v, frameColor: d.frameStyle !== "none" && d.frameColor === d.fg ? v : d.frameColor, frameTextColor: d.frameTextColor === d.fg ? v : d.frameTextColor }, "fg")} />
                  <ColorField label={t(["Background color", "لون الخلفية"])} value={d.bg} onChange={(v) => setDesign({ bg: v }, "bg")} />
                  <Toggle checked={d.bgTransparent} onChange={(v) => setDesign({ bgTransparent: v })} label={t(["Transparent background", "خلفية شفافة"])} desc={t(["Applied to PNG and SVG exports", "تُطبق على تصدير PNG وSVG"])} />
                </div>
                <div className="card space-y-3 p-4">
                  <Toggle checked={grad.enabled} onChange={(v) => setDesign({ gradient: { ...grad, enabled: v } })} label={t(["Gradient", "تدرج لوني"])} />
                  {grad.enabled && (
                    <div className="anim-fade-in space-y-3">
                      <Segmented value={grad.type} onChange={(v) => setDesign({ gradient: { ...grad, type: v } })} label="gradient" options={[{ value: "linear", label: t(["Linear", "خطي"]) }, { value: "radial", label: t(["Radial", "دائري"]) }]} />
                      <ColorField label={t(["From", "من"])} value={grad.from} onChange={(v) => setDesign({ gradient: { ...grad, from: v } }, "g1")} />
                      <ColorField label={t(["To", "إلى"])} value={grad.to} onChange={(v) => setDesign({ gradient: { ...grad, to: v } }, "g2")} />
                      {grad.type === "linear" && <Slider label={t(["Angle", "الزاوية"])} value={grad.angle} min={0} max={360} onChange={(v) => setDesign({ gradient: { ...grad, angle: v } }, "ga")} suffix="°" />}
                    </div>
                  )}
                </div>
                <div className="card space-y-3 p-4">
                  <Toggle checked={d.eyeFrameColor != null} onChange={(v) => setDesign(v ? { eyeFrameColor: d.fg, eyeBallColor: d.fg } : { eyeFrameColor: null, eyeBallColor: null })} label={t(["Custom corner colors", "ألوان مخصصة للزوايا"])} />
                  {d.eyeFrameColor != null && (
                    <div className="anim-fade-in space-y-3">
                      <ColorField label={t(["Corner frame", "إطار الزاوية"])} value={d.eyeFrameColor} onChange={(v) => setDesign({ eyeFrameColor: v }, "ef")} />
                      <ColorField label={t(["Corner center", "مركز الزاوية"])} value={d.eyeBallColor ?? d.eyeFrameColor} onChange={(v) => setDesign({ eyeBallColor: v }, "eb")} />
                    </div>
                  )}
                </div>
                <div className="card p-4">
                  <p className="mb-2 text-[13px] font-medium text-muted">{t(["Quick palettes", "ألوان جاهزة"])}</p>
                  <div className="flex flex-wrap gap-2">
                    {COLOR_PRESETS.map(([fg, bg]) => (
                      <button key={fg + bg} type="button" aria-label={`${fg} / ${bg}`} onClick={() => setDesign({ fg, bg, bgTransparent: false, gradient: { ...grad, enabled: false }, frameColor: fg, frameTextColor: d.frameStyle === "banner" || d.frameStyle === "pill" ? d.frameTextColor : fg })} className="press h-11 w-11 overflow-hidden rounded-xl border border-line" style={{ background: `linear-gradient(135deg, ${fg} 50%, ${bg} 50%)` }} />
                    ))}
                  </div>
                </div>
              </>
            )}

            {tab === "shapes" && (
              <>
                <div className="card p-4">
                  <p className="mb-2 text-[13px] font-medium text-muted">{t(["Dot shape", "شكل النقاط"])}</p>
                  <div className="grid grid-cols-4 gap-2">
                    {DOT_STYLES.map(([v, en, ar]) => <StylePreview key={v} patch={stablePatch({ dotStyle: v })} active={d.dotStyle === v} label={t([en, ar])} onClick={() => setDesign({ dotStyle: v })} />)}
                  </div>
                </div>
                <div className="card p-4">
                  <p className="mb-2 text-[13px] font-medium text-muted">{t(["Corner frame shape", "شكل إطار الزوايا"])}</p>
                  <div className="grid grid-cols-5 gap-2">
                    {EYE_FRAMES.map(([v, en, ar]) => <StylePreview key={v} patch={stablePatch({ eyeFrameStyle: v })} active={d.eyeFrameStyle === v} label={t([en, ar])} onClick={() => setDesign({ eyeFrameStyle: v })} />)}
                  </div>
                </div>
                <div className="card p-4">
                  <p className="mb-2 text-[13px] font-medium text-muted">{t(["Corner center shape", "شكل مركز الزوايا"])}</p>
                  <div className="grid grid-cols-5 gap-2">
                    {EYE_BALLS.map(([v, en, ar]) => <StylePreview key={v} patch={stablePatch({ eyeBallStyle: v })} active={d.eyeBallStyle === v} label={t([en, ar])} onClick={() => setDesign({ eyeBallStyle: v })} />)}
                  </div>
                </div>
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
                    <Slider label={t(["Logo size", "حجم الشعار"])} value={d.logoSize} min={8} max={30} onChange={(v) => setDesign({ logoSize: v }, "ls")} suffix="%" />
                    <Slider label={t(["Clear space around logo", "المساحة المحيطة بالشعار"])} value={d.logoPadding} min={0} max={3} step={0.5} onChange={(v) => setDesign({ logoPadding: v }, "lp")} />
                    <Field label={t(["Logo shape", "شكل الشعار"])}>
                      <Segmented value={d.logoShape} onChange={(v) => setDesign({ logoShape: v })} label="logo shape" options={[{ value: "square", label: t(["Square", "مربع"]) }, { value: "circle", label: t(["Circle", "دائرة"]) }]} />
                    </Field>
                    <ColorField label={t(["Logo backdrop", "خلفية الشعار"])} value={d.logoBg} onChange={(v) => setDesign({ logoBg: v }, "lb")} />
                    <ReadabilityPanel status={rd.status} issues={rd.issues.filter((i) => i.fix?.ecc || i.fix?.logoSize)} onFix={(p) => setDesign(p)} compact />
                  </>
                ) : (
                  <p className="text-sm text-muted">{t(["Add a logo to place it in the center of the code. Large logos reduce readability, so use error-correction level Q or H.", "أضف شعاراً ليوضع في منتصف الرمز. الشعارات الكبيرة تقلل قابلية القراءة، لذا استخدم مستوى التصحيح Q أو H."])}</p>
                )}
              </div>
            )}

            {tab === "frame" && (
              <div className="card space-y-4 p-4">
                <div>
                  <p className="mb-2 text-[13px] font-medium text-muted">{t(["Frame style", "نمط الإطار"])}</p>
                  <div className="grid grid-cols-5 gap-2">
                    {FRAMES.map(([v, en, ar]) => (
                      <button key={v} type="button" aria-pressed={d.frameStyle === v} onClick={() => setDesign({ frameStyle: v, frameText: d.frameText || (v !== "none" ? t(["SCAN ME", "امسحني"]) : "") })} className={cn("press min-h-12 rounded-xl border px-1 text-[12px]", d.frameStyle === v ? "border-brand bg-brand/15 text-brand" : "border-line bg-surface2/50 text-muted")}>
                        {t([en, ar])}
                      </button>
                    ))}
                  </div>
                </div>
                {d.frameStyle !== "none" && (
                  <div className="anim-fade-in space-y-4">
                    <Field label={t(["Caption", "العبارة"])}>
                      <input className={inputCls()} value={d.frameText} maxLength={40} dir="auto" onChange={(e) => setDesign({ frameText: e.target.value }, "ft")} placeholder={t(["SCAN ME", "امسحني"])} />
                    </Field>
                    <Field label={t(["Caption position", "موضع العبارة"])}>
                      <Segmented value={d.frameTextPos} onChange={(v) => setDesign({ frameTextPos: v })} label="position" options={[{ value: "top", label: t(["Above", "فوق"]) }, { value: "bottom", label: t(["Below", "تحت"]) }]} />
                    </Field>
                    <Field label={t(["Font", "الخط"])}>
                      <div className="grid grid-cols-4 gap-2">
                        {FONTS.map(([v, en, ar]) => (
                          <button key={v} type="button" aria-pressed={d.frameFont === v} onClick={() => setDesign({ frameFont: v })} className={cn("press min-h-10 rounded-lg border px-1 text-[12px]", d.frameFont === v ? "border-brand bg-brand/15 text-brand" : "border-line bg-surface2/50 text-muted")}>{t([en, ar])}</button>
                        ))}
                      </div>
                    </Field>
                    <Slider label={t(["Text size", "حجم النص"])} value={d.frameFontScale} min={0.6} max={1.6} step={0.1} onChange={(v) => setDesign({ frameFontScale: v }, "fs")} suffix="×" />
                    {d.frameStyle !== "text" && <ColorField label={t(["Frame color", "لون الإطار"])} value={d.frameColor} onChange={(v) => setDesign({ frameColor: v }, "fc")} />}
                    <ColorField label={t(["Text color", "لون النص"])} value={d.frameTextColor} onChange={(v) => setDesign({ frameTextColor: v }, "ftc")} />
                  </div>
                )}
              </div>
            )}

            {tab === "tech" && (
              <div className="card space-y-4 p-4">
                <Field label={t(["Error correction level", "مستوى تصحيح الأخطاء"])} hint={t(ECC_INFO[d.ecc] as [string, string])}>
                  <Segmented value={d.ecc} onChange={(v) => setDesign({ ecc: v })} label="ecc" options={(["L", "M", "Q", "H"] as EccLevel[]).map((v) => ({ value: v, label: v }))} />
                </Field>
                <Slider label={t(["Quiet zone (modules)", "المنطقة الهادئة (وحدات)"])} value={d.margin} min={0} max={10} onChange={(v) => setDesign({ margin: v }, "mg")} />
                <Slider label={t(["Default export size", "حجم التصدير الافتراضي"])} value={d.size} min={256} max={4096} step={64} onChange={(v) => setDesign({ size: v }, "sz")} suffix=" px" />
                <p className="text-xs leading-5 text-muted">{t(["A quiet zone of at least 4 modules is recommended so scanners can find the code edges. Finder patterns are always preserved.", "يُوصى بمنطقة هادئة لا تقل عن 4 وحدات ليتمكن الماسح من تحديد حواف الرمز. أنماط التحديد محفوظة دائماً."])}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <ExportSheet open={showExport} onClose={() => setShowExport(false)} items={[exportItem]} onPrint={() => { setShowExport(false); setShowPrint(true); }} />
      <PrintSheet
        open={showPrint}
        onClose={() => setShowPrint(false)}
        items={[{ content, design: d, logoHref, label: exportItem.name, details: sheetDetails }]}
      />
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
