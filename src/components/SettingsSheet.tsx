import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Database, Download, FileUp, HardDrive, History, Info, Languages, Moon, Palette, RefreshCw, ScrollText, ShieldCheck, Sun, Trash2, Monitor, Wifi } from "lucide-react";
import { PRIVACY, T, TERMS, formatBytes, formatDate, pick, type LegalDoc } from "../core/i18n";
import type { Lang, ThemeMode } from "../core/types";
import { DB_VERSION, clearHistory, exportBackup, importBackup, parseBackup, requestPersistence, storageEstimate, wipeAll, type ParsedBackup } from "../db/db";
import { useApp } from "../state/AppContext";
import { usePwa } from "../pwa/PwaProvider";
import { downloadBlob, timestampName } from "../engine/exportEngine";
import { cn } from "../utils/cn";
import { WhatsAppMark } from "./BrandIcon";
import ConnectionStatus from "./ConnectionStatus";
import InstallButton from "./InstallButton";
import { Button, Modal, Notice, Segmented, Toggle } from "./ui";

const WA_NUMBER = "447454190643";
const APP_VERSION = "2.0.0";

function Group({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="card p-3.5">
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-muted"><span className="text-brand">{icon}</span>{title}</h3>
      {children}
    </section>
  );
}

function Legal({ doc, lang }: { doc: LegalDoc; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [l, setL] = useState<Lang>(lang);
  return (
    <div className="rounded-xl border border-line bg-surface2/40">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="press flex min-h-12 w-full items-center justify-between px-3 text-start text-sm font-medium">
        {pick(lang, doc.title)}
        <ChevronDown size={18} className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="anim-fade-in border-t border-line px-3 pb-3 pt-2" dir={l === "ar" ? "rtl" : "ltr"}>
          <div className="mb-2 flex justify-end" dir="ltr">
            <div className="w-40"><Segmented value={l} onChange={setL} label="legal language" options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} /></div>
          </div>
          <ol className="list-decimal space-y-1.5 ps-5 text-[13px] leading-6 text-muted">
            {doc.items.map((it, i) => <li key={i}>{pick(l, it)}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

export function SettingsSheet() {
  const { t, lang, setLang, theme, setTheme, saveHistory, setSaveHistory, autoSave, setAutoSave, settingsOpen, setSettingsOpen, toast, fail, confirm, bumpData, dataVersion } = useApp();
  const { needRefresh, installed, swActive, updateNow, checkForUpdates } = usePwa();
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settingsOpen) storageEstimate().then(setStorage);
  }, [settingsOpen, dataVersion]);

  const doUpdate = async () => {
    const ok = await confirm({
      title: ["Update the app?", "تحديث التطبيق؟"],
      message: [
        "The app will reload to apply the new version. Your saved codes, designs and history stay on this device.",
        "سيتم إعادة تحميل التطبيق لتطبيق الإصدار الجديد. تبقى رموزك وتصاميمك وسجلك على هذا الجهاز.",
      ],
      confirmLabel: ["Update now", "تحديث الآن"],
    });
    if (!ok) return;
    setUpdating(true);
    try {
      await updateNow();
    } finally {
      setTimeout(() => setUpdating(false), 4000);
    }
  };

  const doCheckUpdates = async () => {
    setUpdating(true);
    try {
      await checkForUpdates();
      toast(t(["Checked for updates", "تم التحقق من التحديثات"]), needRefresh ? "ok" : "info");
    } finally {
      setUpdating(false);
    }
  };

  const doExport = async () => {
    setBusy(true);
    try {
      downloadBlob(await exportBackup(), `${timestampName("qr-studio-backup")}.json`);
      toast(t(["Backup exported", "تم تصدير النسخة الاحتياطية"]));
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > 100 * 1024 * 1024) throw new Error("big");
      setParsed(parseBackup(await f.text()));
    } catch (e) { fail(e); }
  };

  const doImport = async (mode: "merge" | "replace") => {
    if (!parsed) return;
    if (mode === "replace") {
      const ok = await confirm({ title: ["Replace all data?", "استبدال كل البيانات؟"], message: ["Your current codes, templates and history will be overwritten by the backup. This cannot be undone.", "سيتم الكتابة فوق رموزك وقوالبك وسجلك الحالي ببيانات النسخة. لا يمكن التراجع."], confirmLabel: ["Replace", "استبدال"], danger: true });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await importBackup(parsed, mode);
      bumpData();
      setParsed(null);
      toast(t(["Backup restored. Restart to apply language/theme.", "تمت الاستعادة. أعد فتح التطبيق لتطبيق اللغة/المظهر."]));
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const clearHist = async () => {
    const ok = await confirm({ title: ["Clear history?", "مسح السجل؟"], message: ["All logged activity will be deleted.", "سيتم حذف كل النشاط المسجّل."], confirmLabel: ["Clear", "مسح"], danger: true });
    if (!ok) return;
    try { await clearHistory(); bumpData(); toast(t(T.deleted)); } catch (e) { fail(e); }
  };

  const wipe = async () => {
    const ok = await confirm({ title: ["Delete ALL app data?", "حذف كل بيانات التطبيق؟"], message: ["Saved codes, templates, categories, history and settings will be permanently erased from this device. Export a backup first if you need it.", "سيتم مسح الرموز المحفوظة والقوالب والتصنيفات والسجل والإعدادات نهائياً من هذا الجهاز. صدّر نسخة احتياطية أولاً إن احتجت."], confirmLabel: ["Delete everything", "حذف كل شيء"], danger: true });
    if (!ok) return;
    try { await wipeAll(); bumpData(); toast(t(["All data deleted", "تم حذف كل البيانات"])); } catch (e) { fail(e); }
  };

  const persist = async () => {
    const ok = await requestPersistence();
    toast(ok ? t(["Storage is now protected from automatic cleanup", "أصبح التخزين محمياً من التنظيف التلقائي"]) : t(["The browser did not grant persistent storage", "لم يمنح المتصفح تخزيناً دائماً"]), ok ? "ok" : "info");
  };

  const pct = storage && storage.quota ? Math.min(100, (storage.usage / storage.quota) * 100) : 0;
  const waText = encodeURIComponent(t(["Hello, I'm contacting you about QR Studio Pro.", "مرحباً، أتواصل معك بخصوص تطبيق QR Studio Pro."]));
  const themes: { value: ThemeMode; label: ReactNode }[] = [
    { value: "dark", label: <><Moon size={15} />{t(["Dark", "داكن"])}</> },
    { value: "light", label: <><Sun size={15} />{t(["Light", "فاتح"])}</> },
    { value: "system", label: <><Monitor size={15} />{t(["System", "النظام"])}</> },
  ];

  return (
    <>
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title={t(T.settings)} wide>
        <div className="space-y-3 pb-2">
          <Group icon={<Languages size={17} />} title={t(T.language)}>
            <Segmented value={lang} onChange={setLang} label={t(T.language)} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
          </Group>

          <Group icon={<Palette size={17} />} title={t(["Appearance", "المظهر"])}>
            <Segmented value={theme} onChange={setTheme} label={t(["Appearance", "المظهر"])} options={themes} />
          </Group>

          <Group icon={<Wifi size={17} />} title={t(["Offline & updates", "دون إنترنت والتحديثات"])}>
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <ConnectionStatus autoHideReadyMs={0} />
                <InstallButton />
              </div>
              <div className="flex flex-wrap gap-2">
                {needRefresh ? (
                  <Button variant="primary" disabled={updating} onClick={doUpdate} icon={<RefreshCw size={17} />}>{t(["Update now", "تحديث الآن"])}</Button>
                ) : (
                  <Button disabled={updating} onClick={doCheckUpdates} icon={<RefreshCw size={17} />}>{t(["Check for updates", "التحقق من التحديثات"])}</Button>
                )}
              </div>
              <p className="text-xs leading-5 text-muted">
                {t(
                  [
                    "After the first visit the whole app is stored on this device, so it opens and works with no connection. Updating never touches your saved codes.",
                    "بعد أول زيارة يُخزَّن التطبيق بالكامل على جهازك، فيفتح ويعمل بدون اتصال. التحديث لا يمس رموزك المحفوظة.",
                  ],
                )}
              </p>
              <p className="text-xs text-muted" dir="ltr">
                {swActive
                  ? installed
                    ? "· Installed · offline cache active"
                    : "· Offline cache active"
                  : "· Offline cache not active yet"}
              </p>
            </div>
          </Group>

          <Group icon={<Database size={17} />} title={t(["Backup & restore", "النسخ الاحتياطي والاستعادة"])}>
            <p className="mb-2 text-xs leading-5 text-muted">{t(["Export codes, designs, templates and settings to a file, or restore them. Files stay on your device.", "صدّر الرموز والتصاميم والقوالب والإعدادات إلى ملف، أو استعدها. تبقى الملفات على جهازك."])}</p>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy} onClick={doExport} icon={<Download size={17} />}>{t(["Export backup", "تصدير نسخة"])}</Button>
              <Button disabled={busy} onClick={() => fileRef.current?.click()} icon={<FileUp size={17} />}>{t(["Import backup", "استيراد نسخة"])}</Button>
            </div>
          </Group>

          <Group icon={<History size={17} />} title={t(["History & data", "السجل والبيانات"])}>
            <Toggle checked={saveHistory} onChange={setSaveHistory} label={t(["Keep activity history", "حفظ سجل العمليات"])} desc={t(["Wi-Fi passwords and payment details are never logged.", "لا تُسجَّل كلمات مرور Wi-Fi ولا بيانات الدفع."])} />
            <Toggle checked={autoSave} onChange={setAutoSave} label={t(["Auto-save to My codes", "حفظ تلقائي في رموزي"])} desc={t(["Keeps the current valid code updated in your library.", "يحدّث الرمز الصالح الحالي في مكتبتك تلقائياً."])} />
            <div className="mt-2 rounded-xl border border-line bg-surface2/40 p-3">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted"><HardDrive size={14} />{t(["Local storage", "التخزين المحلي"])}</span>
                <span dir="ltr" className="tabular-nums">{storage ? `${formatBytes(storage.usage)}${storage.quota ? " / " + formatBytes(storage.quota) : ""}` : t(["Unavailable", "غير متاح"])}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface2"><div className="h-full bg-brand" style={{ width: `${Math.max(2, pct)}%` }} /></div>
              {"storage" in navigator && typeof navigator.storage?.persist === "function" && <button type="button" onClick={persist} className="press mt-2 min-h-9 text-xs text-brand">{t(["Protect storage from cleanup", "حماية التخزين من التنظيف"])}</button>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={clearHist} icon={<History size={16} />}>{t(["Clear history", "مسح السجل"])}</Button>
              <Button variant="danger" onClick={wipe} icon={<Trash2 size={16} />}>{t(["Delete all data", "حذف كل البيانات"])}</Button>
            </div>
          </Group>

          <Group icon={<ScrollText size={17} />} title={`${pick(lang, TERMS.title)} · ${pick(lang, PRIVACY.title)}`}>
            <div className="space-y-2">
              <Legal key={lang + "t"} doc={TERMS} lang={lang} />
              <Legal key={lang + "p"} doc={PRIVACY} lang={lang} />
            </div>
          </Group>

          <Group icon={<Info size={17} />} title={t(["App info", "معلومات التطبيق"])}>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand2 text-white"><ShieldCheck size={24} /></div>
                <div className="min-w-0">
                  <p className="font-bold">QR Studio Pro</p>
                  <p className="text-xs text-muted" dir="ltr">v{APP_VERSION} · DB v{DB_VERSION}</p>
                </div>
              </div>
              <p className="rounded-xl border border-line bg-surface2/40 px-3 py-2.5 text-sm">
                {t(["Developed by Abu Omar", "تم التطوير بواسطة أبو عمر"])}
                <span className="block text-xs text-muted">QR Studio Pro</span>
              </p>
              <a
                href={`https://wa.me/${WA_NUMBER}?text=${waText}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t(["Contact the developer on WhatsApp", "تواصل مع المطور عبر واتساب"])}
                className="press group relative flex min-h-16 items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-br from-[#25d366] to-[#128c7e] p-3 text-white shadow-[0_10px_28px_-12px_#25d366] transition-[filter] hover:brightness-110"
              >
                <span className="pointer-events-none absolute -end-6 -top-6 h-24 w-24 rounded-full bg-white/10" aria-hidden="true" />
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white shadow-md"><WhatsAppMark size={26} color="#25d366" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{t(["Contact on WhatsApp", "تواصل عبر واتساب"])}</span>
                  <span className="block text-xs text-white/85" dir="ltr">+44 7454 190643</span>
                </span>
                <ChevronDown size={20} className="-rotate-90 opacity-80 rtl:rotate-90" />
              </a>
            </div>
          </Group>
        </div>
      </Modal>

      <Modal
        open={!!parsed}
        onClose={() => setParsed(null)}
        title={t(["Restore backup", "استعادة نسخة احتياطية"])}
        footer={parsed ? (
          <>
            <Button variant="ghost" onClick={() => setParsed(null)}>{t(T.cancel)}</Button>
            <Button disabled={busy} onClick={() => doImport("merge")}>{t(["Merge (keep my data)", "دمج (الإبقاء على بياناتي)"])}</Button>
            <Button variant="danger" disabled={busy} onClick={() => doImport("replace")}>{t(["Replace all", "استبدال الكل"])}</Button>
          </>
        ) : undefined}
      >
        {parsed && (
          <div className="space-y-3">
            <Notice level="ok">{t(["The file is valid and was checked before import.", "الملف صالح وتم فحصه قبل الاستيراد."])}</Notice>
            <ul className="space-y-1 text-sm">
              <li>{t(["Saved codes", "الرموز المحفوظة"])}: <b>{parsed.counts.qr}</b></li>
              <li>{t(["Templates", "القوالب"])}: <b>{parsed.counts.templates}</b></li>
              <li>{t(["Categories", "التصنيفات"])}: <b>{parsed.counts.categories}</b></li>
              <li>{t(["History items", "عناصر السجل"])}: <b>{parsed.counts.history}</b></li>
              {parsed.exportedAt > 0 && <li>{t(["Created", "تاريخ الإنشاء"])}: <b>{formatDate(parsed.exportedAt, lang)}</b></li>}
            </ul>
            {parsed.counts.skipped > 0 && <Notice level="warn">{parsed.counts.skipped} {t(["invalid records were skipped.", "سجلات غير صالحة تم تخطيها."])}</Notice>}
            <p className="text-xs leading-5 text-muted">{t(["Merge adds missing items without touching existing ones. Replace overwrites everything and asks for confirmation.", "الدمج يضيف العناصر الناقصة دون المساس بالموجود. الاستبدال يكتب فوق كل شيء ويطلب تأكيداً."])}</p>
          </div>
        )}
      </Modal>
    </>
  );
}
