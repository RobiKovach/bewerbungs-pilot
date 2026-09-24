import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { YEAR_MONTH } from './validate';

export function AiMark({ show }: { show: boolean }) {
  const { t } = useTranslation();
  return show ? <span className="badge ai" title={t('profile.aiHint')}>{t('profile.aiCheck')}</span> : null;
}

function Shell({ id, label, ai, hint, error, children }: { id: string; label: string; ai?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-head"><label htmlFor={id}>{label}</label><AiMark show={ai ?? false} /></div>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

interface TextFieldProps {
  label: string; value: string; onChange: (v: string) => void;
  ai?: boolean; hint?: string; error?: string; multiline?: boolean; type?: string; placeholder?: string;
}

export function TextField({ label, value, onChange, ai, hint, error, multiline = false, type = 'text', placeholder }: TextFieldProps) {
  const id = useId();
  return (
    <Shell id={id} label={label} ai={ai} hint={hint} error={error}>
      {multiline
        ? <textarea id={id} rows={4} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input id={id} type={type} value={value} placeholder={placeholder} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} />}
    </Shell>
  );
}

/** "2021-05" or "2021"; empty "to" = still ongoing. */
export function YearMonthField({ label, value, onChange, ai }: { label: string; value: string; onChange: (v: string) => void; ai?: boolean }) {
  const { t } = useTranslation();
  const bad = !YEAR_MONTH.test(value);
  return (
    <TextField label={label} value={value} onChange={(v) => onChange(v.trim())} ai={ai} placeholder="2021-05"
      hint={bad ? undefined : t('profile.dateHint')} error={bad ? t('profile.dateInvalid') : undefined} />
  );
}

export function SelectField<V extends string>({ label, value, options, optionLabel, onChange, ai }: {
  label: string; value: V; options: readonly V[]; optionLabel: (v: V) => string; onChange: (v: V) => void; ai?: boolean;
}) {
  const id = useId();
  return (
    <Shell id={id} label={label} ai={ai}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as V)}>
        {options.map((o) => <option key={o} value={o}>{optionLabel(o)}</option>)}
      </select>
    </Shell>
  );
}

/** A list of short texts, one per line. Keeps its own text so empty lines can be typed. */
export function LinesField({ label, value, onChange, ai, hint }: { label: string; value: string[]; onChange: (v: string[]) => void; ai?: boolean; hint?: string }) {
  const id = useId();
  const [text, setText] = useState(value.join('\n'));
  return (
    <Shell id={id} label={label} ai={ai} hint={hint}>
      <textarea id={id} rows={3} value={text} onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean));
      }} />
    </Shell>
  );
}

export function NumberField({ label, value, onChange, max, ai }: { label: string; value: number | null; onChange: (v: number | null) => void; max: number; ai?: boolean }) {
  const id = useId();
  return (
    <Shell id={id} label={label} ai={ai}>
      <input id={id} type="number" min={0} max={max} value={value ?? ''} onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === '' ? null : Math.min(max, Math.max(0, Math.round(Number(raw)))));
      }} />
    </Shell>
  );
}

export function CheckboxGroup<V extends string>({ legend, values, selected, optionLabel, onChange, ai }: {
  legend: string; values: readonly V[]; selected: V[]; optionLabel: (v: V) => string; onChange: (v: V[]) => void; ai?: boolean;
}) {
  return (
    <fieldset className="checkbox-group">
      <legend>{legend} <AiMark show={ai ?? false} /></legend>
      {values.map((v) => (
        <label key={v}>
          <input type="checkbox" checked={selected.includes(v)} onChange={(e) => onChange(e.target.checked ? [...selected, v] : selected.filter((x) => x !== v))} />
          {' '}{optionLabel(v)}
        </label>
      ))}
    </fieldset>
  );
}
