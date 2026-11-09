import { memo, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clipboard, Layers, Palette, Plus, Printer, Save, Search, Share2, Download, Sparkles } from "lucide-react";
import type { QrCategoryId, QrTypeDef } from "../core/types";
import { CATEGORIES, detailRows, QR_TYPES, typesOfCategory } from "../core/qrTypes";
import { T } from "../core/i18n";
import { useApp } from "../state/AppContext";
import { useProject } from "../state/ProjectContext";
import { copyText, canShareFile, renderToBlob, shareFile, downloadBlob, sanitizeFilename } from "../engine/exportEngine";
import { HERO, withTransition } from "../utils/transition";
import { cn } from "../utils/cn";
import { TypeIcon } from "./BrandIcon";
import { QrImage, ReadabilityPanel, useQrRender, useReadability } from "./QrView";
import { TypeForm } from "./TypeForm";
import { Button, Empty, Field, IconBtn, inputCls, Spinner } from "./ui";
import { ExportSheet } from "./ExportSheet";
import { PrintSheet } from "./PrintSheet";
import BatchPanel from "./BatchPanel";

// ---------- Type cards ----------
/**
 * One tile, the same for every category: a square card with the platform's mark
 * and its name under it. The social grid used to be the only one laid out this
 * way while the other categories fell back to a wide list row, which made half
 * the create screen look like a different app. The description stays reachable
 * as the tile's tooltip and accessible name.
 */
const TypeCard = memo(function TypeCard({ def, onPick }: { def: QrTypeDef; onPick: (id: string, el: HTMLElement) => void }) {
  const { t } = useApp();
  return (
    <button
      type="button"
      onClick={(e) => onPick(def.id, e.currentTarget)}
      title={t(def.desc)}
      aria-label={`${t(def.title)} — ${t(def.desc)}`}
      className="press cv-card card group flex aspect-square w-full flex-col items-center justify-center gap-2 px-1.5 py-3 text-center hover:border-brand/50"
    >
      <TypeIcon icon={def.icon} size={46} />
      <span className="line-clamp-2 w-full text-[12.5px] font-semibold leading-tight">{t(def.title)}</span>
    </button>
  );
});

function Picker({ onPick }: { onPick: (id: string, el: HTMLElement) => void }) {
  const { t } = useApp();
  const { setStep } = useProject();
  const [cat, setCat] = useState<QrCategoryId | "all">("all");
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const searchHits = useMemo(
    () => (query ? QR_TYPES.filter((d) => d.category !== "hidden" && (d.title.join(" ") + " " + d.desc.join(" ")).toLowerCase().includes(query)) : []),
    [query],
  );
  const shown = cat === "all" ? CATEGORIES : CATEGORIES.filter((c) => c.id === cat);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2.5 px-3 pb-2 pt-3 md:px-5">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(["Search QR types…", "ابحث عن نوع QR…"])} aria-label={t(T.search)} className={cn(inputCls(), "ps-10")} />
          </div>
          <Button onClick={() => setStep("batch")} icon={<Layers size={18} />} className="shrink-0" title={t(["Batch QR generation", "إنشاء رموز بالجملة"])}>
            <span className="hidden sm:inline">{t(["Batch", "دفعة"])}</span>
          </Button>
        </div>
        {!query && (
          <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 md:mx-0 md:px-0" role="tablist" aria-label={t(["Categories", "التصنيفات"])}>
            {[{ id: "all" as const, title: T.all }, ...CATEGORIES].map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={cat === c.id}
                type="button"
                onClick={() => setCat(c.id)}
                className={cn("press min-h-10 shrink-0 rounded-full border px-4 text-[13px] font-medium", cat === c.id ? "border-brand bg-brand/15 text-brand" : "border-line bg-surface2/60 text-muted hover:text-fg")}
              >
                {t(c.title)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="scroll-area min-h-0 flex-1 px-3 pb-4 md:px-5">
        <div key={query ? "s" : cat} className="anim-fade-up space-y-5">
          {query ? (
            searchHits.length ? (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {searchHits.map((d) => <TypeCard key={d.id} def={d} onPick={onPick} />)}
              </div>
            ) : (
              <Empty icon={<Search size={28} />} title={t(T.noResults)} desc={t(["Try another word", "جرّب كلمة أخرى"])} />
            )
          ) : (
            shown.map((c) => {
              const list = typesOfCategory(c.id);
              const social = c.id === "social";
              return (
                <section key={c.id} aria-label={t(c.title)}>
                  <div className={cn("mb-2.5 overflow-hidden rounded-2xl border p-3", social ? "border-brand/25 bg-gradient-to-br from-brand/15 via-surface2 to-brand2/10" : "border-line bg-surface2/40")}>
                    <div className="flex items-center gap-2">
                      {social && <Sparkles size={16} className="shrink-0 text-brand" />}
                      <h3 className="text-[14px] font-bold">{t(c.title)}</h3>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{social ? t(["Dedicated forms with validation for every platform", "نماذج مخصصة مع تحقق لكل منصة"]) : t(c.desc)}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
                    {list.map((d) => <TypeCard key={d.id} def={d} onPick={onPick} />)}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Form step ----------
function FormStep() {
  const { t, dir, go } = useApp();
  const { project, type, build, logoHref, setValues, setStep } = useProject();
  const [submitted, setSubmitted] = useState(false);
  const { url, error } = useQrRender(build.content, project.design, logoHref);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const onCreate = () => {
    if (!build.valid) {
      setSubmitted(true);
      return;
    }
    withTransition(() => setStep("result"));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 md:px-5">
        <IconBtn label={t(T.back)} onClick={() => withTransition(() => setStep("pick"))}><Back size={22} /></IconBtn>
        <TypeIcon icon={type.icon} size={44} heroName={HERO} />
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-bold">{t(type.title)}</h2>
          <p className="truncate text-xs text-muted">{t(type.desc)}</p>
        </div>
      </div>

      <div className="scroll-area min-h-0 flex-1 px-3 pb-3 pt-3 md:px-5">
        <div className="anim-fade-up grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="card order-2 p-4 md:order-1">
            <TypeForm key={type.id} type={type} values={project.values} errors={build.errors} onChange={setValues} submitted={submitted} />
          </div>
          <div className="order-1 md:order-2 md:sticky md:top-0 md:self-start">
            <div className="card flex items-center gap-4 p-3 md:flex-col md:p-4">
              <div className="w-[112px] shrink-0 rounded-xl bg-white p-1.5 md:w-full md:max-w-[240px]" aria-live="polite">
                {build.valid && !error ? (
                  <QrImage content={build.content} design={project.design} logoHref={logoHref} className="w-full" />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 text-center text-[11px] leading-4 text-zinc-500">
                    {error ? t(["Content is too long", "المحتوى طويل جداً"]) : t(["Live preview", "معاينة فورية"])}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 text-sm md:w-full md:text-center">
                {error ? (
                  <p className="text-bad">{t(["Content exceeds QR capacity. Shorten it or lower error correction.", "المحتوى يتجاوز سعة QR. اختصره أو خفّض مستوى التصحيح."])}</p>
                ) : build.valid ? (
                  <p className="flex items-center gap-1.5 text-ok md:justify-center"><Check size={16} />{t(["Ready — updates as you type", "جاهز — يتحدث أثناء الكتابة"])}</p>
                ) : (
                  <p className="text-muted">{t(["Fill the required fields to generate the code", "املأ الحقول المطلوبة لتوليد الرمز"])}</p>
                )}
                {url && build.valid && <p className="mt-1 text-xs text-muted" dir="ltr">{build.content.length} {t(["chars", "حرف"])}</p>}
                <Button size="sm" className="mt-2" onClick={() => go("design")} icon={<Palette size={16} />}>{t(T.design)}</Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-surface/80 px-3 py-2.5 md:px-5">
        <Button variant="primary" size="lg" full onClick={onCreate} icon={<Sparkles size={18} />}>
          {t(["Create QR code", "إنشاء رمز QR"])}
        </Button>
      </div>
    </div>
  );
}

// ---------- Result step ----------
function ResultStep() {
  const { t, dir, go, toast, fail, logActivity } = useApp();
  const { project, type, build, logoHref, setName, setStep, save, newProject } = useProject();
  const [showExport, setShowExport] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [saving, setSaving] = useState(false);
  const rd = useReadability(build.content, project.design, logoHref);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  const defaultName = `${t(type.title)}`;

  // log creation once when this step opens
  useEffect(() => {
    if (build.valid) logActivity({ action: "create", type: project.typeId, content: build.content, name: project.name || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const item = { content: build.content, design: project.design, logoHref, name: project.name || defaultName, type: project.typeId };

  const onSave = async () => {
    setSaving(true);
    await save();
    setSaving(false);
  };

  const onShare = useCallback(async () => {
    try {
      const opts = { format: "png" as const, size: 1024, transparent: false, quality: 0.92, includeFrame: true, includeLogo: true, filename: "", paper: "a4" as const, printMm: 60 };
      const blob = await renderToBlob(build.content, project.design, logoHref, opts);
      const fname = `${sanitizeFilename(item.name)}.png`;
      if (canShareFile(blob, fname)) {
        await shareFile(blob, fname, item.name);
      } else {
        setShowExport(true);
        toast(["Direct sharing isn't available — use the export options", "المشاركة المباشرة غير متاحة — استخدم خيارات التصدير"], "info");
      }
    } catch (e) {
      fail(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build.content, project.design, logoHref]);

  const onCopy = async () => {
    try {
      await copyText(build.content);
      toast(t(T.copied));
    } catch (e) {
      fail(e);
    }
  };

  // What the code itself cannot carry (a Sham Cash QR may only hold the wallet
  // address), printed as a small table under the code.
  const sheetDetails = useMemo(
    () =>
      detailRows(type, project.values).map((r) => ({
        label: t(r.label),
        value: r.valueTx ? t(r.valueTx) : r.value,
      })),
    [type, project.values, t],
  );

  const quickPng = async () => {
    try {
      const blob = await renderToBlob(build.content, project.design, logoHref, { format: "png", size: 1024, transparent: false, quality: 0.92, includeFrame: true, includeLogo: true, filename: "", paper: "a4", printMm: 60 });
      downloadBlob(blob, `${sanitizeFilename(item.name)}.png`);
      logActivity({ action: "export", type: project.typeId, content: build.content, name: item.name });
      toast(t(["Saved PNG to Downloads", "تم حفظ PNG في التنزيلات"]));
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 md:px-5">
        <IconBtn label={t(T.back)} onClick={() => withTransition(() => setStep("form"))}><Back size={22} /></IconBtn>
        <TypeIcon icon={type.icon} size={40} heroName={HERO} />
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold">{t(["Your QR code", "رمز QR الخاص بك"])}</h2>
        <Button size="sm" variant="ghost" onClick={newProject} icon={<Plus size={16} />}>{t(["New", "جديد"])}</Button>
      </div>

      <div className="scroll-area min-h-0 flex-1 px-3 pb-4 pt-3 md:px-5">
        <div className="anim-pop mx-auto grid max-w-4xl gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
          <div className="card flex items-center justify-center p-4">
            <div className="w-full max-w-[280px] rounded-2xl bg-white p-2 shadow-xl">
              <QrImage content={build.content} design={project.design} logoHref={logoHref} className="w-full" />
            </div>
          </div>
          <div className="space-y-3">
            <Field label={t(["Name (for My codes)", "الاسم (لرموزي)"])}>
              <input className={inputCls()} value={project.name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} maxLength={120} />
            </Field>
            <ReadabilityPanel status={rd.status} issues={rd.issues} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Button variant="primary" onClick={onSave} disabled={saving} icon={saving ? <Spinner size={16} /> : <Save size={18} />}>{project.savedId ? t(["Update", "تحديث"]) : t(T.save)}</Button>
              <Button onClick={quickPng} icon={<Download size={18} />}>PNG</Button>
              <Button onClick={() => setShowExport(true)} icon={<Download size={18} />}>{t(T.export)}</Button>
              <Button onClick={onShare} icon={<Share2 size={18} />}>{t(T.share)}</Button>
              <Button onClick={() => setShowPrint(true)} icon={<Printer size={18} />}>{t(T.print)}</Button>
              <Button onClick={() => go("design")} icon={<Palette size={18} />}>{t(T.design)}</Button>
              <Button onClick={onCopy} icon={<Clipboard size={18} />} className="col-span-2 sm:col-span-3">{t(["Copy content", "نسخ المحتوى"])}</Button>
            </div>
            <div className="card p-3 text-xs text-muted">
              <p className="mb-1 font-semibold text-fg">{t(["Encoded content", "المحتوى المشفّر"])}</p>
              <p className="max-h-24 overflow-auto whitespace-pre-wrap break-all" dir="auto">{type.sensitive ? t(["Hidden for privacy (sensitive data)", "مخفي للخصوصية (بيانات حساسة)"]) : build.content}</p>
            </div>
          </div>
        </div>
      </div>
      <ExportSheet open={showExport} onClose={() => setShowExport(false)} items={[item]} onPrint={() => { setShowExport(false); setShowPrint(true); }} />
      <PrintSheet
        open={showPrint}
        onClose={() => setShowPrint(false)}
        items={[{ content: build.content, design: project.design, logoHref, label: item.name, details: sheetDetails }]}
      />
    </div>
  );
}

export default function CreateScreen() {
  const { step, selectType } = useProject();
  const { t } = useApp();

  const onPick = useCallback((id: string, el: HTMLElement) => {
    const icon = el.firstElementChild as HTMLElement | null;
    if (icon) icon.style.viewTransitionName = HERO;
    withTransition(() => selectType(id));
  }, [selectType]);

  return (
    <div className="h-full min-h-0">
      {step === "pick" && <Picker onPick={onPick} />}
      {step === "form" && <FormStep />}
      {step === "result" && <ResultStep />}
      {step === "batch" && (
        <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-muted"><Spinner />{t(T.loading)}</div>}>
          <BatchPanel />
        </Suspense>
      )}
    </div>
  );
}
