import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { T } from "../core/i18n";
import { useApp } from "../state/AppContext";
import { buildPrintHtml, printHtml, type PrintItem } from "../engine/printEngine";
import { Button, Field, inputCls, Modal, Slider, Spinner, Toggle } from "./ui";

const PAPER_MM = { a4: [210, 297], a5: [148, 210], letter: [216, 279] } as const;

export function PrintSheet({ open, onClose, items }: { open: boolean; onClose: () => void; items: PrintItem[] }) {
  const { t, dir, fail, toast } = useApp();
  const [paper, setPaper] = useState<"a4" | "a5" | "letter">("a4");
  const [sizeMm, setSizeMm] = useState(50);
  const [marginMm, setMarginMm] = useState(12);
  const [labels, setLabels] = useState(items.length > 1);
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);

  const [pw, ph] = PAPER_MM[paper];
  const pxW = pw * 3.7795;
  const pxH = ph * 3.7795;

  useEffect(() => {
    if (!open) return;
    setLabels(items.length > 1);
  }, [open, items.length]);

  useEffect(() => {
    if (!open || !items.length) return;
    let alive = true;
    setBusy(true);
    const id = setTimeout(() => {
      buildPrintHtml(items, { sizeMm, marginMm, gapMm: 6, labels, paper, dir, title: "QR Studio Pro" })
        .then((h) => alive && setHtml(h))
        .catch((e) => alive && fail(e))
        .finally(() => alive && setBusy(false));
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [open, items, sizeMm, marginMm, labels, paper, dir, fail]);

  useEffect(() => {
    if (!open || !wrap.current) return;
    const el = wrap.current;
    const update = () => setScale(Math.min(1, el.clientWidth / pxW));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, pxW]);

  const doPrint = async () => {
    if (!html) return;
    try {
      await printHtml(html);
      toast(["Print dialog opened", "تم فتح نافذة الطباعة"], "info");
    } catch (e) {
      fail(e);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`${t(T.print)} · ${items.length}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t(T.close)}</Button>
          <Button variant="primary" disabled={!html || busy} onClick={doPrint} icon={<Printer size={18} />}>{t(T.print)}</Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-3">
          <Field label={t(["Paper", "الورق"])}>
            <select className={inputCls()} value={paper} onChange={(e) => setPaper(e.target.value as typeof paper)}>
              <option value="a4">A4</option>
              <option value="a5">A5</option>
              <option value="letter">Letter</option>
            </select>
          </Field>
          <Slider label={t(["Code size", "حجم الرمز"])} value={sizeMm} min={20} max={150} onChange={setSizeMm} suffix=" mm" />
          <Slider label={t(["Page margin", "هامش الصفحة"])} value={marginMm} min={5} max={30} onChange={setMarginMm} suffix=" mm" />
          <Toggle checked={labels} onChange={setLabels} label={t(["Show names", "إظهار الأسماء"])} />
          <p className="text-xs text-muted">{t(["App controls are hidden: only the page below is printed.", "عناصر التطبيق مخفية: تُطبع الصفحة أدناه فقط."])}</p>
        </div>
        <div ref={wrap} className="relative min-w-0 overflow-hidden rounded-xl border border-line bg-zinc-300/20" style={{ height: pxH * scale + 16 }}>
          {busy && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30"><Spinner size={26} /></div>}
          <div dir="ltr" style={{ width: pxW, height: pxH, transform: `scale(${scale})`, transformOrigin: "top left", margin: 8 * (1 / Math.max(scale, 0.01)) * scale }}>
            {html && <iframe title="print preview" srcDoc={html} sandbox="" className="h-full w-full border-0 bg-white shadow-lg" />}
          </div>
        </div>
      </div>
    </Modal>
  );
}
