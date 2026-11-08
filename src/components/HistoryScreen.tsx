import { memo, useEffect, useMemo, useState } from "react";
import { Clipboard, Download, Eye, History, QrCode, RefreshCw, ScanLine, Save, Search, Trash2, Heart, Layers } from "lucide-react";
import type { HistoryRecord } from "../core/types";
import { TYPE_BY_ID } from "../core/qrTypes";
import { T, formatDate } from "../core/i18n";
import { clearHistory, deleteHistory, getStats, listHistory, restoreHistory, type Stats } from "../db/db";
import { useApp } from "../state/AppContext";
import { useProject } from "../state/ProjectContext";
import { useAsyncList } from "../state/useData";
import { copyText } from "../engine/exportEngine";
import { cn } from "../utils/cn";
import { TypeIcon } from "./BrandIcon";
import { Empty, IconBtn, inputCls } from "./ui";

const ACTIONS = {
  scan: { label: ["Scanned", "ممسوح"], icon: ScanLine, cls: "bg-brand2/15 text-brand2" },
  create: { label: ["Created", "منشأ"], icon: QrCode, cls: "bg-brand/15 text-brand" },
  save: { label: ["Saved", "محفوظ"], icon: Save, cls: "bg-ok/15 text-ok" },
  export: { label: ["Exported", "مصدّر"], icon: Download, cls: "bg-warn/15 text-warn" },
} as const;

const Row = memo(function Row({ rec, onReuse, onCopy, onDelete }: { rec: HistoryRecord; onReuse: (r: HistoryRecord) => void; onCopy: (r: HistoryRecord) => void; onDelete: (r: HistoryRecord) => void }) {
  const { t, lang } = useApp();
  const def = TYPE_BY_ID[rec.type] ?? TYPE_BY_ID.text;
  const a = ACTIONS[rec.action] ?? ACTIONS.scan;
  const redacted = rec.content.includes("••••") || rec.content.startsWith("EPC (hidden)") || rec.content.startsWith("batch #") || rec.content.startsWith("ZIP (");
  return (
    // `min-w-0` keeps the grid column from being stretched by the nowrap content,
    // which used to push rows far past the width of a phone screen.
    <div className="cv-card card flex min-w-0 items-center gap-3 p-3">
      <TypeIcon icon={def.icon} size={42} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", a.cls)}><a.icon size={11} />{t(a.label)}</span>
          <span className="truncate text-[13px] font-semibold">{rec.name || t(def.title)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted" dir="auto">{rec.content.replace(/\s+/g, " ")}</p>
        <p className="text-[11px] text-muted">{t(def.title)} · {formatDate(rec.scanned_at, lang)}</p>
      </div>
      <div className="flex shrink-0">
        {!redacted && <IconBtn label={t(["Reuse", "إعادة استخدام"])} onClick={() => onReuse(rec)}><RefreshCw size={18} /></IconBtn>}
        {!redacted && <IconBtn label={t(T.copy)} onClick={() => onCopy(rec)}><Clipboard size={18} /></IconBtn>}
        <IconBtn label={t(T.delete)} onClick={() => onDelete(rec)}><Trash2 size={18} /></IconBtn>
      </div>
    </div>
  );
});

type DateF = "all" | "today" | "week" | "month";

export default function HistoryScreen() {
  const { t, dataVersion, bumpData, toast, fail, confirm, go, saveHistory } = useApp();
  const { loadRaw } = useProject();
  const { data, loading } = useAsyncList(listHistory, dataVersion);
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState("");
  const [action, setAction] = useState<string>("all");
  const [typeF, setTypeF] = useState("all");
  const [dateF, setDateF] = useState<DateF>("all");

  useEffect(() => { getStats().then(setStats).catch(() => setStats(null)); }, [dataVersion]);

  const types = useMemo(() => [...new Set(data.map((d) => d.type))], [data]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const now = Date.now();
    const from = dateF === "today" ? new Date().setHours(0, 0, 0, 0) : dateF === "week" ? now - 7 * 864e5 : dateF === "month" ? now - 30 * 864e5 : 0;
    return data.filter((d) => (action === "all" || d.action === action) && (typeF === "all" || d.type === typeF) && d.scanned_at >= from && (!s || (d.content + " " + (d.name ?? "")).toLowerCase().includes(s)));
  }, [data, q, action, typeF, dateF]);

  const onReuse = (r: HistoryRecord) => { loadRaw(r.content, r.type); go("create"); };
  const onCopy = async (r: HistoryRecord) => { try { await copyText(r.content); toast(t(T.copied)); } catch (e) { fail(e); } };
  const onDelete = async (r: HistoryRecord) => {
    try {
      await deleteHistory([r.id as number]);
      bumpData();
      toast(t(T.deleted), "info", { label: t(T.undo), run: () => { restoreHistory([r]).then(bumpData).catch(fail); } });
    } catch (e) { fail(e); }
  };
  const onClear = async () => {
    const ok = await confirm({ title: ["Clear the whole history?", "مسح السجل بالكامل؟"], message: ["All logged activity will be deleted. Your saved codes are not affected.", "سيتم حذف كل النشاط المسجّل. رموزك المحفوظة لن تتأثر."], confirmLabel: ["Clear all", "مسح الكل"], danger: true });
    if (!ok) return;
    try { await clearHistory(); bumpData(); toast(t(T.deleted)); } catch (e) { fail(e); }
  };

  const statItems = stats ? [
    { icon: QrCode, label: t(["Created", "المنشأة"]), v: stats.created },
    { icon: Layers, label: t(["Saved", "المحفوظة"]), v: stats.saved },
    { icon: Heart, label: t(T.favorites), v: stats.favorites },
    { icon: ScanLine, label: t(["Scanned", "الممسوحة"]), v: stats.scanned },
    { icon: Download, label: t(["Exports", "التصديرات"]), v: stats.exported },
  ] : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 px-3 pb-2 pt-3 md:px-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {statItems.map((s) => (
            <div key={s.label} className="card flex min-w-0 items-center gap-2 px-2.5 py-2">
              <s.icon size={18} className="shrink-0 text-brand" />
              <div className="min-w-0">
                <p className="truncate text-lg font-bold leading-5 tabular-nums">{s.v}</p>
                <p className="truncate text-[11px] text-muted">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="px-1 text-[11px] leading-4 text-muted">{t(["Local statistics only. Static QR codes cannot be tracked remotely — that requires dynamic links and a server.", "إحصائيات محلية فقط. لا يمكن تتبع مسح الرموز الثابتة عن بُعد — هذا يتطلب روابط ديناميكية وخادماً."])}</p>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={17} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(["Search history…", "ابحث في السجل…"])} aria-label={t(T.search)} className={cn(inputCls(), "ps-10")} />
          </div>
          <IconBtn label={t(["Clear history", "مسح السجل"])} onClick={onClear} disabled={!data.length}><Trash2 size={20} /></IconBtn>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <select aria-label={t(["Operation", "العملية"])} value={action} onChange={(e) => setAction(e.target.value)} className="min-h-10 w-full min-w-0 truncate rounded-xl border border-line bg-surface2 px-2 text-[13px]">
            <option value="all">{t(["All operations", "كل العمليات"])}</option>
            {(Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]).map((k) => <option key={k} value={k}>{t(ACTIONS[k].label)}</option>)}
          </select>
          <select aria-label={t(T.type)} value={typeF} onChange={(e) => setTypeF(e.target.value)} className="min-h-10 w-full min-w-0 truncate rounded-xl border border-line bg-surface2 px-2 text-[13px]">
            <option value="all">{t(["All types", "كل الأنواع"])}</option>
            {types.map((ty) => <option key={ty} value={ty}>{t((TYPE_BY_ID[ty] ?? TYPE_BY_ID.text).title)}</option>)}
          </select>
          <select aria-label={t(T.date)} value={dateF} onChange={(e) => setDateF(e.target.value as DateF)} className="min-h-10 w-full min-w-0 truncate rounded-xl border border-line bg-surface2 px-2 text-[13px]">
            <option value="all">{t(["Any date", "أي تاريخ"])}</option>
            <option value="today">{t(T.today)}</option>
            <option value="week">{t(T.week)}</option>
            <option value="month">{t(T.month)}</option>
          </select>
        </div>
      </div>
      <div className="scroll-area min-h-0 flex-1 px-3 pb-4 md:px-5">
        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-[72px] rounded-2xl" />)}</div>
        ) : list.length === 0 ? (
          <Empty
            icon={saveHistory ? <History size={30} /> : <Eye size={30} />}
            title={data.length ? t(T.noResults) : t(["The history is empty", "السجل فارغ"])}
            desc={!saveHistory ? t(["History logging is turned off in Settings.", "تسجيل السجل متوقف من الإعدادات."]) : data.length ? undefined : t(["Created, saved, exported and scanned codes appear here.", "تظهر هنا الرموز المنشأة والمحفوظة والمصدّرة والممسوحة."])}
          />
        ) : (
          <div className="anim-fade-up grid gap-2 lg:grid-cols-2">
            {list.slice(0, 300).map((r) => <Row key={r.id} rec={r} onReuse={onReuse} onCopy={onCopy} onDelete={onDelete} />)}
          </div>
        )}
      </div>
    </div>
  );
}
