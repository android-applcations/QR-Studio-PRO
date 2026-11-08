import { memo, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import type { DesignConfig, TemplateRecord } from "../core/types";
import { BUILTIN_TEMPLATES, designFromTemplate } from "../core/designDefaults";
import { T } from "../core/i18n";
import { addTemplate, deleteTemplate, listTemplates } from "../db/db";
import { useApp } from "../state/AppContext";
import { useProject } from "../state/ProjectContext";
import { useAsyncList, useLogoMap } from "../state/useData";
import { QrImage } from "./QrView";
import { Button, Empty, Field, IconBtn, inputCls, Modal } from "./ui";

const SAMPLE = "QR Studio Pro";

const TemplateCard = memo(function TemplateCard({ name, design, content, logo, onUse, onDelete, badge }: { name: string; design: DesignConfig; content: string; logo: string | null; onUse: () => void; onDelete?: () => void; badge?: boolean }) {
  const { t } = useApp();
  return (
    <div className="cv-card card flex flex-col gap-2 p-2.5">
      <button type="button" onClick={onUse} className="press rounded-xl bg-white p-1.5" aria-label={`${t(T.templates)}: ${name}`}>
        <QrImage content={content} design={design} logoHref={logo} className="w-full" />
      </button>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" dir="auto">{badge && <Star size={12} className="me-1 inline text-warn" fill="currentColor" />}{name}</span>
        {onDelete && <IconBtn label={t(T.delete)} onClick={onDelete} className="!h-9 !w-9"><Trash2 size={16} /></IconBtn>}
      </div>
      <Button size="sm" variant="primary" onClick={onUse}>{t(["Use template", "استخدام القالب"])}</Button>
    </div>
  );
});

export default function TemplatesScreen() {
  const { t, dataVersion, bumpData, toast, fail, go, confirm } = useApp();
  const { project, build, logoHref, replaceDesign } = useProject();
  const { data: mine } = useAsyncList(listTemplates, dataVersion);
  const logos = useLogoMap(mine.map((m) => m.design_config.logoId));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const content = build.valid ? build.content : SAMPLE;

  const apply = (d: DesignConfig, label: string) => {
    replaceDesign(d);
    toast([`Applied “${label}”`, `تم تطبيق «${label}»`]);
    go("design");
  };

  const saveCurrent = async () => {
    if (!name.trim()) return;
    try {
      await addTemplate(name.trim(), project.design);
      bumpData();
      setOpen(false);
      setName("");
      toast(t(["Template saved", "تم حفظ القالب"]));
    } catch (e) { fail(e); }
  };

  const remove = async (tpl: TemplateRecord) => {
    const ok = await confirm({ title: ["Delete this template?", "حذف هذا القالب؟"], message: [`“${tpl.name}” will be removed.`, `سيتم حذف «${tpl.name}».`], confirmLabel: T.delete, danger: true });
    if (!ok) return;
    try { await deleteTemplate(tpl.id as number); bumpData(); toast(t(T.deleted)); } catch (e) { fail(e); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-3 md:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold">{t(T.templates)}</h2>
          <p className="truncate text-xs text-muted">{t(["Fully editable after applying", "قابلة للتعديل بالكامل بعد التطبيق"])}</p>
        </div>
        <Button onClick={() => setOpen(true)} icon={<Plus size={18} />}>{t(["Save current design", "حفظ التصميم الحالي"])}</Button>
      </div>
      <div className="scroll-area min-h-0 flex-1 space-y-5 px-3 pb-4 pt-2 md:px-5">
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-muted">{t(["My templates", "قوالبي"])}</h3>
          {mine.length === 0 ? (
            <Empty icon={<Star size={26} />} title={t(["No custom templates yet", "لا توجد قوالب خاصة بعد"])} desc={t(["Save your current design to reuse it any time.", "احفظ تصميمك الحالي لإعادة استخدامه في أي وقت."])} />
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              {mine.map((m) => (
                <TemplateCard key={m.id} badge name={m.name} design={m.design_config} content={content} logo={m.design_config.logoId != null ? logos[m.design_config.logoId] ?? null : null} onUse={() => apply(m.design_config, m.name)} onDelete={() => remove(m)} />
              ))}
            </div>
          )}
        </section>
        <section>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-muted">{t(["Ready-made", "جاهزة"])}</h3>
          <div className="anim-fade-up grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {BUILTIN_TEMPLATES.map((b) => {
              const d = designFromTemplate(b.design, { logoId: project.design.logoId, size: project.design.size });
              return <TemplateCard key={b.id} name={t(b.name)} design={d} content={content} logo={d.logoId != null ? logoHref : null} onUse={() => apply(d, t(b.name))} />;
            })}
          </div>
        </section>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={t(["Save current design", "حفظ التصميم الحالي"])} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t(T.cancel)}</Button><Button variant="primary" disabled={!name.trim()} onClick={saveCurrent}>{t(T.save)}</Button></>}>
        <Field label={t(["Template name", "اسم القالب"])}>
          <input autoFocus className={inputCls()} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} onKeyDown={(e) => { if (e.key === "Enter") void saveCurrent(); }} />
        </Field>
      </Modal>
    </div>
  );
}
