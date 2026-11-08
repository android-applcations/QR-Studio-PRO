import { memo, useCallback, useMemo, useState } from "react";
import { Check, Clipboard, Copy, Download, FolderPlus, Heart, Pencil, Printer, Search, Share2, Star, Tag, Trash2, QrCode, CheckSquare } from "lucide-react";
import type { QrRecord } from "../core/types";
import { TYPE_BY_ID } from "../core/qrTypes";
import { T, formatDate } from "../core/i18n";
import { addCategory, deleteCategory, deleteQr, duplicateQr, listCategories, listQr, patchManyQr, patchQr, restoreQr } from "../db/db";
import { useApp } from "../state/AppContext";
import { useProject } from "../state/ProjectContext";
import { useAsyncList, useLogoMap } from "../state/useData";
import { canCopyImage, canShareFile, copyImage, copyText, renderToBlob, sanitizeFilename, shareFile } from "../engine/exportEngine";
import { cn } from "../utils/cn";
import { QrImage } from "./QrView";
import { TypeIcon } from "./BrandIcon";
import { Button, Empty, Field, IconBtn, inputCls, Modal } from "./ui";
import { ExportSheet, type ExportItem } from "./ExportSheet";
import { PrintSheet } from "./PrintSheet";

type Sort = "date" | "name" | "type";

const Card = memo(function Card({ rec, logo, selected, selecting, onOpen, onToggleFav, onSelect }: { rec: QrRecord; logo: string | null; selected: boolean; selecting: boolean; onOpen: (r: QrRecord) => void; onToggleFav: (r: QrRecord) => void; onSelect: (r: QrRecord) => void }) {
  const { t, lang } = useApp();
  const def = TYPE_BY_ID[rec.type] ?? TYPE_BY_ID.raw;
  return (
    <div className={cn("cv-card card relative flex gap-3 p-2.5", selected && "!border-brand ring-2 ring-brand/40")}>
      <button type="button" onClick={() => (selecting ? onSelect(rec) : onOpen(rec))} className="press flex min-w-0 flex-1 items-center gap-3 text-start" aria-label={rec.name}>
        <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-white p-1">
          <QrImage content={rec.content} design={rec.design_config} logoHref={logo} className="h-full w-full" />
          {selecting && (
            <span className={cn("absolute start-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2", selected ? "border-brand bg-brand text-white" : "border-zinc-400 bg-white/80")}>
              {selected && <Check size={12} />}
            </span>
          )}
        </div>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold" dir="auto">{rec.name}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <TypeIcon icon={def.icon} size={16} />
            <span className="truncate">{t(def.title)}</span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted">{formatDate(rec.updated_at, lang)}{rec.category ? ` · ${rec.category}` : ""}</span>
        </span>
      </button>
      <IconBtn label={t(T.favorites)} active={rec.favorite === 1} onClick={() => onToggleFav(rec)} className="self-start"><Heart size={19} fill={rec.favorite ? "currentColor" : "none"} /></IconBtn>
    </div>
  );
});

export default function LibraryScreen() {
  const { t, lang, dataVersion, bumpData, toast, fail, confirm, go } = useApp();
  const { loadRecord } = useProject();
  const { data: records, loading } = useAsyncList(listQr, dataVersion);
  const { data: cats } = useAsyncList(listCategories, dataVersion);
  const logos = useLogoMap(records.map((r) => r.design_config.logoId));
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("date");
  const [cat, setCat] = useState<string>("__all");
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [active, setActive] = useState<QrRecord | null>(null);
  const [catModal, setCatModal] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [exportItems, setExportItems] = useState<ExportItem[] | null>(null);
  const [printRecs, setPrintRecs] = useState<QrRecord[] | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    let r = records.filter((x) => {
      if (cat === "__fav" && x.favorite !== 1) return false;
      if (cat !== "__all" && cat !== "__fav" && x.category !== cat) return false;
      if (!s) return true;
      const def = TYPE_BY_ID[x.type];
      return (x.name + " " + x.description + " " + x.content + " " + (def ? def.title.join(" ") : x.type)).toLowerCase().includes(s);
    });
    r = [...r].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, lang) : sort === "type" ? a.type.localeCompare(b.type) || b.updated_at - a.updated_at : b.updated_at - a.updated_at));
    return r;
  }, [records, q, sort, cat, lang]);

  const openRec = useCallback((r: QrRecord) => setActive(r), []);
  const toggleFav = useCallback(async (r: QrRecord) => {
    try { await patchQr(r.id as number, { favorite: r.favorite ? 0 : 1 }); bumpData(); } catch (e) { fail(e); }
  }, [bumpData, fail]);
  const toggleSel = useCallback((r: QrRecord) => setSel((s) => { const n = new Set(s); if (n.has(r.id as number)) n.delete(r.id as number); else n.add(r.id as number); return n; }), []);

  const toExport = (r: QrRecord): ExportItem => ({ content: r.content, design: r.design_config, logoHref: r.design_config.logoId != null ? logos[r.design_config.logoId] ?? null : null, name: r.name, type: r.type });
  const selected = records.filter((r) => sel.has(r.id as number));

  const removeRecords = async (recs: QrRecord[]) => {
    const ok = await confirm({
      title: [`Delete ${recs.length} code(s)?`, `حذف ${recs.length} رمز؟`],
      message: ["You can undo right after deleting.", "يمكنك التراجع مباشرة بعد الحذف."],
      confirmLabel: T.delete, danger: true,
    });
    if (!ok) return;
    try {
      await deleteQr(recs.map((r) => r.id as number));
      bumpData();
      setSel(new Set());
      setSelecting(false);
      setActive(null);
      toast(t([`Deleted ${recs.length}`, `تم حذف ${recs.length}`]), "info", {
        label: t(T.undo),
        run: () => { restoreQr(recs).then(bumpData).then(() => toast(t(["Restored", "تمت الاستعادة"]))).catch(fail); },
      });
    } catch (e) { fail(e); }
  };

  const bulkFav = async () => {
    try { await patchManyQr([...sel], { favorite: 1 }); bumpData(); toast(t(T.saved)); } catch (e) { fail(e); }
  };
  const bulkMove = async (category: string) => {
    try { await patchManyQr([...sel], { category }); bumpData(); setMoveOpen(false); toast(t(T.saved)); } catch (e) { fail(e); }
  };

  const edit = (r: QrRecord, to: "create" | "design") => { loadRecord(r); setActive(null); go(to); };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 px-3 pb-2 pt-3 md:px-5">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(["Search my codes…", "ابحث في رموزي…"])} aria-label={t(T.search)} className={cn(inputCls(), "ps-10")} />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t(["Sort", "الفرز"])} className="min-h-11 shrink-0 rounded-xl border border-line bg-surface2 px-2 text-sm">
            <option value="date">{t(T.date)}</option>
            <option value="name">{t(T.name)}</option>
            <option value="type">{t(T.type)}</option>
          </select>
          <IconBtn label={t(T.select)} active={selecting} onClick={() => { setSelecting((v) => !v); setSel(new Set()); }}><CheckSquare size={21} /></IconBtn>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {[{ id: "__all", label: t(T.all) }, { id: "__fav", label: `★ ${t(T.favorites)}` }, ...cats.map((c) => ({ id: c.name, label: c.name }))].map((c) => (
            <button key={c.id} type="button" onClick={() => setCat(c.id)} className={cn("press min-h-10 shrink-0 rounded-full border px-4 text-[13px] font-medium", cat === c.id ? "border-brand bg-brand/15 text-brand" : "border-line bg-surface2/60 text-muted")}>{c.label}</button>
          ))}
          <button type="button" onClick={() => setCatModal(true)} className="press flex min-h-10 shrink-0 items-center gap-1 rounded-full border border-dashed border-line px-3 text-[13px] text-muted"><FolderPlus size={15} />{t(["Categories", "التصنيفات"])}</button>
        </div>
      </div>

      {selecting && (
        <div className="anim-fade-in flex shrink-0 flex-wrap items-center gap-2 border-y border-line bg-brand/10 px-3 py-2 md:px-5">
          <span className="me-auto text-sm font-medium">{sel.size} {t(["selected", "محدد"])}</span>
          <Button size="sm" onClick={() => setSel(new Set(list.map((r) => r.id as number)))}>{t(T.all)}</Button>
          <Button size="sm" disabled={!sel.size} onClick={bulkFav} icon={<Heart size={15} />}>{t(T.favorites)}</Button>
          <Button size="sm" disabled={!sel.size} onClick={() => setMoveOpen(true)} icon={<Tag size={15} />}>{t(T.category)}</Button>
          <Button size="sm" disabled={!sel.size} onClick={() => setExportItems(selected.map(toExport))} icon={<Download size={15} />}>{t(T.export)}</Button>
          <Button size="sm" disabled={!sel.size} onClick={() => setPrintRecs(selected)} icon={<Printer size={15} />}>{t(T.print)}</Button>
          <Button size="sm" variant="danger" disabled={!sel.size} onClick={() => removeRecords(selected)} icon={<Trash2 size={15} />}>{t(T.delete)}</Button>
        </div>
      )}

      <div className="scroll-area min-h-0 flex-1 px-3 pb-4 pt-1 md:px-5">
        {loading ? (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[94px] rounded-2xl" />)}</div>
        ) : list.length === 0 ? (
          records.length === 0 ? (
            <Empty icon={<QrCode size={30} />} title={t(["No saved codes yet", "لا توجد رموز محفوظة بعد"])} desc={t(["Create a code and press Save to keep it here with its full design.", "أنشئ رمزاً واضغط حفظ ليبقى هنا بتصميمه الكامل."])} action={<Button variant="primary" onClick={() => go("create")}>{t(T.create)}</Button>} />
          ) : (
            <Empty icon={<Search size={28} />} title={t(T.noResults)} />
          )
        ) : (
          <div key={cat + sort} className="anim-fade-up grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((r) => (
              <Card key={r.id} rec={r} logo={r.design_config.logoId != null ? logos[r.design_config.logoId] ?? null : null} selected={sel.has(r.id as number)} selecting={selecting} onOpen={openRec} onToggleFav={toggleFav} onSelect={toggleSel} />
            ))}
          </div>
        )}
      </div>

      {active && <ItemModal rec={records.find((r) => r.id === active.id) ?? active} cats={cats.map((c) => c.name)} logo={active.design_config.logoId != null ? logos[active.design_config.logoId] ?? null : null} onClose={() => setActive(null)} onEdit={edit} onDelete={(r) => removeRecords([r])} onExport={(r) => { setExportItems([toExport(r)]); }} onPrint={(r) => setPrintRecs([r])} onDup={async (r) => { try { await duplicateQr(r.id as number, t(["(copy)", "(نسخة)"])); bumpData(); toast(t(T.saved)); setActive(null); } catch (e) { fail(e); } }} onSaved={() => { bumpData(); }} />}

      <ExportSheet open={!!exportItems} onClose={() => setExportItems(null)} items={exportItems ?? []} onPrint={exportItems?.length === 1 ? () => { const id = active?.id; setExportItems(null); const r = records.find((x) => x.id === id); if (r) setPrintRecs([r]); } : undefined} />
      <PrintSheet open={!!printRecs} onClose={() => setPrintRecs(null)} items={(printRecs ?? []).map((r) => ({ content: r.content, design: r.design_config, logoHref: r.design_config.logoId != null ? logos[r.design_config.logoId] ?? null : null, label: r.name }))} />

      <Modal open={catModal} onClose={() => setCatModal(false)} title={t(["Categories", "التصنيفات"])}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input className={inputCls()} value={newCat} onChange={(e) => setNewCat(e.target.value)} maxLength={40} placeholder={t(["New category name", "اسم تصنيف جديد"])} onKeyDown={(e) => { if (e.key === "Enter") document.getElementById("add-cat")?.click(); }} />
            <Button id="add-cat" variant="primary" disabled={!newCat.trim()} onClick={async () => { try { await addCategory(newCat); setNewCat(""); bumpData(); } catch (e) { fail(e); } }}>{t(["Add", "إضافة"])}</Button>
          </div>
          {cats.length === 0 && <p className="text-sm text-muted">{t(["No categories yet.", "لا توجد تصنيفات بعد."])}</p>}
          <ul className="space-y-1.5">
            {cats.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-xl border border-line bg-surface2/50 px-3 py-1">
                <span className="truncate" dir="auto">{c.name}</span>
                <IconBtn label={t(T.delete)} onClick={async () => { try { await deleteCategory(c.id as number); if (cat === c.name) setCat("__all"); bumpData(); } catch (e) { fail(e); } }}><Trash2 size={18} /></IconBtn>
              </li>
            ))}
          </ul>
        </div>
      </Modal>

      <Modal open={moveOpen} onClose={() => setMoveOpen(false)} title={t(["Move to category", "نقل إلى تصنيف"])}>
        <div className="space-y-2">
          <Button full onClick={() => bulkMove("")}>{t(["No category", "بدون تصنيف"])}</Button>
          {cats.map((c) => <Button key={c.id} full onClick={() => bulkMove(c.name)}>{c.name}</Button>)}
          {cats.length === 0 && <p className="text-sm text-muted">{t(["Create a category first.", "أنشئ تصنيفاً أولاً."])}</p>}
        </div>
      </Modal>
    </div>
  );
}

function ItemModal({ rec, cats, logo, onClose, onEdit, onDelete, onExport, onPrint, onDup, onSaved }: {
  rec: QrRecord; cats: string[]; logo: string | null; onClose: () => void;
  onEdit: (r: QrRecord, to: "create" | "design") => void; onDelete: (r: QrRecord) => void; onExport: (r: QrRecord) => void;
  onPrint: (r: QrRecord) => void; onDup: (r: QrRecord) => void; onSaved: () => void;
}) {
  const { t, lang, toast, fail } = useApp();
  const [name, setName] = useState(rec.name);
  const [desc, setDesc] = useState(rec.description);
  const [category, setCategory] = useState(rec.category);
  const def = TYPE_BY_ID[rec.type] ?? TYPE_BY_ID.raw;
  const dirty = name !== rec.name || desc !== rec.description || category !== rec.category;

  const saveMeta = async () => {
    try { await patchQr(rec.id as number, { name: name.trim() || rec.name, description: desc.trim(), category }); onSaved(); toast(t(T.saved)); } catch (e) { fail(e); }
  };
  const png = () => renderToBlob(rec.content, rec.design_config, logo, { format: "png", size: 1024, transparent: false, quality: 0.92, includeFrame: true, includeLogo: true, filename: "", paper: "a4", printMm: 60 });
  const share = async () => {
    try {
      const blob = await png();
      const f = `${sanitizeFilename(rec.name)}.png`;
      if (canShareFile(blob, f)) await shareFile(blob, f, rec.name);
      else onExport(rec);
    } catch (e) { fail(e); }
  };
  const copyImg = async () => {
    try {
      if (canCopyImage()) { await copyImage(await png()); toast(t(T.copied)); }
      else { await copyText(rec.content); toast(t(["Image copy isn't supported — content copied", "نسخ الصورة غير مدعوم — تم نسخ المحتوى"]), "info"); }
    } catch (e) { fail(e); }
  };

  return (
    <Modal open onClose={onClose} title={rec.name} wide>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="mx-auto w-full max-w-[220px] space-y-2">
          <div className="rounded-2xl bg-white p-2"><QrImage content={rec.content} design={rec.design_config} logoHref={logo} className="w-full" /></div>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted"><TypeIcon icon={def.icon} size={18} />{t(def.title)} · {formatDate(rec.created_at, lang)}</p>
        </div>
        <div className="space-y-3">
          <Field label={t(T.name)}><input className={inputCls()} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} dir="auto" /></Field>
          <Field label={t(T.description)}><textarea className={`${inputCls()} min-h-20 resize-none py-2.5`} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={400} dir="auto" /></Field>
          <Field label={t(T.category)}>
            <select className={inputCls()} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t(["No category", "بدون تصنيف"])}</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {dirty && <Button variant="primary" onClick={saveMeta} icon={<Check size={17} />}>{t(T.save)}</Button>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Button onClick={() => onEdit(rec, "create")} icon={<Pencil size={16} />}>{t(["Edit data", "تعديل البيانات"])}</Button>
            <Button onClick={() => onEdit(rec, "design")} icon={<Star size={16} />}>{t(["Edit design", "تعديل التصميم"])}</Button>
            <Button onClick={() => onDup(rec)} icon={<Copy size={16} />}>{t(["Duplicate", "تكرار"])}</Button>
            <Button onClick={() => onExport(rec)} icon={<Download size={16} />}>{t(T.export)}</Button>
            <Button onClick={share} icon={<Share2 size={16} />}>{t(T.share)}</Button>
            <Button onClick={() => onPrint(rec)} icon={<Printer size={16} />}>{t(T.print)}</Button>
            <Button onClick={async () => { try { await copyText(rec.content); toast(t(T.copied)); } catch (e) { fail(e); } }} icon={<Clipboard size={16} />}>{t(["Copy content", "نسخ المحتوى"])}</Button>
            <Button onClick={copyImg} icon={<Clipboard size={16} />}>{t(["Copy image", "نسخ الصورة"])}</Button>
            <Button variant="danger" onClick={() => onDelete(rec)} icon={<Trash2 size={16} />}>{t(T.delete)}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
