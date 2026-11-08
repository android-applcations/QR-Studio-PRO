import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, FileUp, FileArchive, Printer, Save, Sparkles, Trash2 } from "lucide-react";
import type { DesignConfig, TemplateRecord } from "../core/types";
import { BUILTIN_TEMPLATES, designFromTemplate } from "../core/designDefaults";
import { T } from "../core/i18n";
import { useApp } from "../state/AppContext";
import { useProject } from "../state/ProjectContext";
import { buildRows, buildZip, generateBatch, parseCsv, type BatchKind, type GeneratedItem, type ZipFormat } from "../engine/batch";
import { downloadBlob, timestampName } from "../engine/exportEngine";
import { svgToDataUrl } from "../engine/designEngine";
import { listTemplates, saveBatch } from "../db/db";
import { getLogoDataUrl } from "../db/db";
import { Button, Empty, Field, IconBtn, inputCls, Notice, Segmented } from "./ui";
import { PrintSheet } from "./PrintSheet";

export default function BatchPanel() {
  const { t, dir, toast, fail, bumpData, logActivity } = useApp();
  const { project, setStep, logoHref } = useProject();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<BatchKind>("url");
  const [hasHeader, setHasHeader] = useState(false);
  const [contentCol, setContentCol] = useState(0);
  const [nameCol, setNameCol] = useState(-1);
  const [tplKey, setTplKey] = useState("current");
  const [userTpls, setUserTpls] = useState<TemplateRecord[]>([]);
  const [prefix, setPrefix] = useState("");
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [items, setItems] = useState<GeneratedItem[] | null>(null);
  const [failed, setFailed] = useState(0);
  const [zipFmt, setZipFmt] = useState<ZipFormat>("png");
  const [busy, setBusy] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [usedDesign, setUsedDesign] = useState<DesignConfig>(project.design);
  const [usedLogo, setUsedLogo] = useState<string | null>(null);
  const cancel = useRef({ cancelled: false });
  const fileRef = useRef<HTMLInputElement>(null);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  useEffect(() => { listTemplates().then(setUserTpls).catch(() => undefined); }, []);
  useEffect(() => () => { cancel.current.cancelled = true; }, []);

  const table = useMemo(() => {
    const all = parseCsv(text);
    return hasHeader ? all.slice(1) : all;
  }, [text, hasHeader]);
  const cols = useMemo(() => Math.max(1, ...parseCsv(text).slice(0, 50).map((r) => r.length)), [text]);
  const rows = useMemo(() => buildRows(table, kind, Math.min(contentCol, cols - 1), nameCol >= cols ? -1 : nameCol), [table, kind, contentCol, nameCol, cols]);
  const validCount = rows.filter((r) => !r.error).length;
  const invalidCount = rows.length - validCount;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { toast(["File is larger than 3 MB", "حجم الملف أكبر من 3 ميغابايت"], "err"); return; }
    if (!/\.(csv|txt|tsv)$/i.test(f.name) && !/^text\//.test(f.type)) { toast(["Choose a CSV or TXT file", "اختر ملف CSV أو TXT"], "err"); return; }
    const content = await f.text();
    setText(content);
    const first = (parseCsv(content)[0] ?? []).join(" ");
    const header = /(url|link|name|content|text|phone|email|رابط|اسم|نص|هاتف|بريد)/i.test(first) && !/https?:\/\//i.test(first);
    setHasHeader(header);
    if (header) {
      const cells = parseCsv(content)[0] ?? [];
      const ci = cells.findIndex((c) => /(url|link|content|text|phone|email|رابط|محتوى|نص|هاتف|بريد)/i.test(c));
      const ni = cells.findIndex((c) => /(name|title|label|اسم|عنوان)/i.test(c));
      setContentCol(ci >= 0 ? ci : 0);
      setNameCol(ni >= 0 && ni !== ci ? ni : -1);
    } else { setContentCol(0); setNameCol(-1); }
    toast(t(["File imported", "تم استيراد الملف"]));
  };

  const resolveDesign = (): DesignConfig => {
    if (tplKey === "current") return project.design;
    if (tplKey.startsWith("b:")) {
      const b = BUILTIN_TEMPLATES.find((x) => x.id === tplKey.slice(2));
      return designFromTemplate(b?.design ?? {}, { logoId: null, size: project.design.size });
    }
    const u = userTpls.find((x) => String(x.id) === tplKey.slice(2));
    return u ? u.design_config : project.design;
  };

  const generate = async () => {
    const design = resolveDesign();
    setBusy(true);
    setItems(null);
    cancel.current = { cancelled: false };
    try {
      const logo = design.logoId != null ? (design.logoId === project.design.logoId ? logoHref : await getLogoDataUrl(design.logoId)) : null;
      setUsedDesign(design);
      setUsedLogo(logo);
      const res = await generateBatch(rows, design, logo, prefix.trim() || t(["QR", "رمز"]), (d, n) => setProgress([d, n]), cancel.current);
      setItems(res.items);
      setFailed(res.failed.length + invalidCount);
      toast([`Generated ${res.items.length} codes`, `تم إنشاء ${res.items.length} رمزاً`]);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const onSave = async () => {
    if (!items?.length) return;
    try {
      const now = Date.now();
      const id = await saveBatch(prefix.trim() || `${t(["Batch", "دفعة"])} ${new Date(now).toLocaleDateString()}`, items.map((it) => ({
        name: it.name, description: "", content: it.content, type: kind === "phone" ? "phone" : kind === "email" ? "email" : kind === "url" ? "url" : "text",
        form_values: (kind === "url" ? { url: it.content } : kind === "phone" ? { phone: it.content.replace(/^tel:/, "") } : kind === "email" ? { to: it.content.replace(/^mailto:/, "") } : { text: it.content }) as Record<string, string>,
        design_config: usedDesign, favorite: 0 as const, category: "",
      })));
      logActivity({ action: "save", type: kind, content: `batch #${id} (${items.length})`, name: prefix || "Batch" });
      bumpData();
      toast([`Saved ${items.length} codes to My codes`, `تم حفظ ${items.length} رمزاً في رموزي`]);
    } catch (e) { fail(e); }
  };

  const onZip = async () => {
    if (!items?.length) return;
    setBusy(true);
    try {
      const blob = await buildZip(items, zipFmt, 1024, (d, n) => setProgress([d, n]));
      downloadBlob(blob, `${timestampName("qr-batch")}.zip`);
      toast(t(["ZIP file created", "تم إنشاء ملف ZIP"]));
      logActivity({ action: "export", type: kind, content: `ZIP (${items.length})`, name: "Batch" });
    } catch (e) { fail(e); } finally { setBusy(false); setProgress(null); }
  };

  const pct = progress ? Math.round((progress[0] / Math.max(1, progress[1])) * 100) : 0;
  const kinds: { value: BatchKind; label: string }[] = [
    { value: "url", label: t(["Links", "روابط"]) }, { value: "text", label: t(["Text", "نص"]) },
    { value: "phone", label: t(["Phones", "هواتف"]) }, { value: "email", label: t(["Emails", "بريد"]) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 md:px-5">
        <IconBtn label={t(T.back)} onClick={() => setStep("pick")}><Back size={22} /></IconBtn>
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-bold">{t(["Batch QR generation", "إنشاء رموز بالجملة"])}</h2>
          <p className="truncate text-xs text-muted">{t(["Paste lines or import a CSV file", "الصق أسطراً أو استورد ملف CSV"])}</p>
        </div>
      </div>

      <div className="scroll-area min-h-0 flex-1 space-y-4 px-3 pb-5 pt-3 md:px-5">
        <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
          <div className="card space-y-3 p-4">
            <Field label={t(["Data type", "نوع البيانات"])}><Segmented value={kind} onChange={setKind} options={kinds} label="kind" /></Field>
            <Field label={t(["Data (one per line, or CSV)", "البيانات (سطر لكل رمز أو CSV)"])}>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} dir="ltr" spellCheck={false} placeholder={kind === "url" ? "https://example.com/a\nhttps://example.com/b" : "…"} className={`${inputCls()} resize-y py-2.5 font-mono text-[13px] leading-5`} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
              <Button onClick={() => fileRef.current?.click()} icon={<FileUp size={18} />}>{t(["Import CSV", "استيراد CSV"])}</Button>
              {text && <Button variant="ghost" onClick={() => { setText(""); setItems(null); }} icon={<Trash2 size={16} />}>{t(["Clear", "مسح"])}</Button>}
            </div>
            {cols > 1 && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t(["Content column", "عمود المحتوى"])}>
                  <select className={inputCls()} value={contentCol} onChange={(e) => setContentCol(Number(e.target.value))}>
                    {Array.from({ length: cols }, (_, i) => <option key={i} value={i}>{t(["Column", "عمود"])} {i + 1}</option>)}
                  </select>
                </Field>
                <Field label={t(["Name column", "عمود الاسم"])}>
                  <select className={inputCls()} value={nameCol} onChange={(e) => setNameCol(Number(e.target.value))}>
                    <option value={-1}>{t(["Auto numbering", "ترقيم تلقائي"])}</option>
                    {Array.from({ length: cols }, (_, i) => <option key={i} value={i}>{t(["Column", "عمود"])} {i + 1}</option>)}
                  </select>
                </Field>
              </div>
            )}
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="h-5 w-5 accent-[var(--c-brand)]" />
              {t(["First row is a header", "السطر الأول عناوين أعمدة"])}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t(["Unified design", "التصميم الموحد"])}>
                <select className={inputCls()} value={tplKey} onChange={(e) => setTplKey(e.target.value)}>
                  <option value="current">{t(["Current design", "التصميم الحالي"])}</option>
                  {BUILTIN_TEMPLATES.map((b) => <option key={b.id} value={`b:${b.id}`}>{t(b.name)}</option>)}
                  {userTpls.map((u) => <option key={u.id} value={`u:${u.id}`}>★ {u.name}</option>)}
                </select>
              </Field>
              <Field label={t(["Auto-name prefix", "بادئة الأسماء"])}>
                <input className={inputCls()} value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={40} placeholder={t(["QR", "رمز"])} />
              </Field>
            </div>
          </div>

          <div className="card flex min-h-[220px] flex-col p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t(["Data preview", "معاينة البيانات"])}</h3>
              {rows.length > 0 && (
                <span className="text-xs text-muted">
                  <span className="text-ok">{validCount} {t(["valid", "صالح"])}</span>
                  {invalidCount > 0 && <span className="text-bad"> · {invalidCount} {t(["invalid", "غير صالح"])}</span>}
                </span>
              )}
            </div>
            {rows.length === 0 ? (
              <Empty icon={<FileUp size={26} />} title={t(["No data yet", "لا توجد بيانات بعد"])} desc={t(["Paste lines or import a CSV file to preview them here.", "الصق أسطراً أو استورد ملف CSV لمعاينتها هنا."])} />
            ) : (
              <ul className="scroll-area max-h-72 min-h-0 flex-1 space-y-1.5">
                {rows.slice(0, 100).map((r) => (
                  <li key={r.line} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${r.error ? "border-bad/40 bg-bad/10" : "border-line bg-surface2/50"}`}>
                    <span className="mt-0.5 w-6 shrink-0 text-muted" dir="ltr">{r.line}</span>
                    <span className="min-w-0 flex-1 break-all" dir="auto">{r.name && <b>{r.name}: </b>}{r.raw || "—"}</span>
                    {r.error && <span className="shrink-0 text-bad">{t(r.error)}</span>}
                  </li>
                ))}
                {rows.length > 100 && <li className="px-1 text-xs text-muted">… +{rows.length - 100}</li>}
              </ul>
            )}
            <Button variant="primary" size="lg" className="mt-3" disabled={busy || validCount === 0} onClick={generate} icon={<Sparkles size={18} />}>
              {busy && progress ? `${pct}%` : t([`Generate ${validCount || ""} codes`, `إنشاء ${validCount || ""} رمز`])}
            </Button>
            {busy && progress && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface2"><div className="h-full bg-brand transition-[width]" style={{ width: `${pct}%` }} /></div>}
          </div>
        </div>

        {items && (
          <div className="card anim-fade-up mx-auto max-w-5xl space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t(["Results", "النتائج"])} · {items.length}</h3>
              {failed > 0 && <Notice level="warn">{failed} {t(["rows were skipped", "سجلات تم تخطيها"])}</Notice>}
            </div>
            {items.length === 0 ? (
              <Empty icon={<Trash2 size={24} />} title={t(["Nothing was generated", "لم يتم إنشاء أي رمز"])} />
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                {items.slice(0, 48).map((it, i) => (
                  <figure key={i} className="cv-card m-0 text-center">
                    <img src={svgToDataUrl(it.svg)} alt={it.name} className="w-full rounded-lg bg-white p-1" loading="lazy" />
                    <figcaption className="mt-1 truncate text-[11px] text-muted" dir="auto">{it.name}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            {items.length > 48 && <p className="text-xs text-muted">+{items.length - 48} {t(["more (included in exports)", "أخرى (ضمن التصدير)"])}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-44"><Segmented value={zipFmt} onChange={setZipFmt} label="zip format" options={[{ value: "png", label: "PNG" }, { value: "jpg", label: "JPG" }, { value: "svg", label: "SVG" }]} /></div>
              <Button variant="primary" disabled={busy || !items.length} onClick={onZip} icon={<FileArchive size={18} />}>{t(["Download ZIP", "تنزيل ZIP"])}</Button>
              <Button disabled={!items.length} onClick={onSave} icon={<Save size={18} />}>{t(["Save batch", "حفظ المجموعة"])}</Button>
              <Button disabled={!items.length} onClick={() => setShowPrint(true)} icon={<Printer size={18} />}>{t(T.print)}</Button>
            </div>
          </div>
        )}
      </div>
      {items && (
        <PrintSheet open={showPrint} onClose={() => setShowPrint(false)} items={items.map((it) => ({ content: it.content, design: usedDesign, logoHref: usedLogo, label: it.name }))} />
      )}
    </div>
  );
}
