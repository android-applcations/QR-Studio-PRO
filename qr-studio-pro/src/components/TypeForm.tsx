import { memo, useState } from "react";
import type { FormValues, QrTypeDef, Tx } from "../core/types";
import { visibleFields } from "../core/qrTypes";
import { useApp } from "../state/AppContext";
import { Field, inputCls, Toggle } from "./ui";

interface Props {
  type: QrTypeDef;
  values: FormValues;
  errors: Record<string, Tx>;
  onChange: (v: FormValues) => void;
  submitted: boolean;
}

export const TypeForm = memo(function TypeForm({ type, values, errors, onChange, submitted }: Props) {
  const { t } = useApp();
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const fields = visibleFields(type, values);
  const set = (k: string, v: string) => onChange({ ...values, [k]: v });

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
      {fields.map((fd) => {
        const show = submitted || touched[fd.key];
        const err = show ? errors[fd.key] : undefined;
        const val = values[fd.key] ?? "";
        const id = `f-${type.id}-${fd.key}`;
        const span = fd.half ? "col-span-1" : "col-span-2";
        const common = {
          id,
          value: val,
          dir: fd.dir ?? "auto",
          onBlur: () => setTouched((s) => ({ ...s, [fd.key]: true })),
          "aria-invalid": !!err,
          "aria-describedby": err ? `${id}-e` : undefined,
        } as const;
        if (fd.kind === "checkbox") {
          return (
            <div key={fd.key} className={span}>
              <Toggle checked={val === "1"} onChange={(v) => set(fd.key, v ? "1" : "")} label={t(fd.label)} />
            </div>
          );
        }
        let control;
        if (fd.kind === "select") {
          control = (
            <select {...common} className={inputCls(!!err)} onChange={(e) => set(fd.key, e.target.value)}>
              {fd.options?.map((o) => (
                <option key={o.value} value={o.value}>{t(o.label)}</option>
              ))}
            </select>
          );
        } else if (fd.kind === "textarea") {
          control = (
            <textarea {...common} rows={3} maxLength={fd.maxLength} placeholder={fd.placeholder} onChange={(e) => set(fd.key, e.target.value)} className={`${inputCls(!!err)} min-h-24 resize-none py-2.5 leading-6`} />
          );
        } else {
          const htmlType = fd.kind === "datetime" ? "datetime-local" : fd.kind === "number" ? "text" : fd.kind;
          control = (
            <div className="flex items-stretch">
              {fd.prefix && <span className="flex items-center rounded-s-xl border border-e-0 border-line bg-surface2 px-3 text-muted" dir="ltr">{fd.prefix}</span>}
              <input
                {...common}
                type={htmlType}
                inputMode={fd.kind === "number" ? "decimal" : fd.kind === "tel" ? "tel" : fd.kind === "email" ? "email" : fd.kind === "url" ? "url" : undefined}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={fd.maxLength}
                placeholder={fd.placeholder}
                onChange={(e) => set(fd.key, fd.kind === "number" ? e.target.value.replace(/[^0-9.\-]/g, "") : e.target.value)}
                className={`${inputCls(!!err)} ${fd.prefix ? "!rounded-s-none" : ""}`}
              />
            </div>
          );
        }
        return (
          <div key={fd.key} className={span}>
            <Field label={`${t(fd.label)}${fd.required ? " *" : ""}`} htmlFor={id} error={err ? t(err) : undefined} hint={fd.hint ? t(fd.hint) : undefined}>
              {control}
            </Field>
          </div>
        );
      })}
    </div>
  );
});
