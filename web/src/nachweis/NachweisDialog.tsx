import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { saveFile } from '../files/save';
import type { NachweisCandidate, NachweisSetup, NachweisView } from '../types';
import { NachweisSetupForm } from './NachweisSetupForm';

/** Rows per page of each form (server: BBW_ROWS_PER_PAGE / STANDARD_ROWS_PER_PAGE). */
const ROWS_PER_PAGE = { 'bbw-qgz-pp018': 6, standard: 10 } as const;

const pad = (n: number) => String(n).padStart(2, '0');
/** DD.MM.YYYY in local time, as the server writes the dates on the form. */
export function germanDay(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
export function nachweisFileName(picked: readonly NachweisCandidate[]): string {
  const days = picked.map((c) => c.appliedAt).sort();
  return `Bewerbungsnachweis_${germanDay(days[0]!)}_${germanDay(days.at(-1)!)}.docx`;
}
export const pagesFor = (setup: NachweisSetup, rows: number) =>
  Math.max(1, Math.ceil(rows / ROWS_PER_PAGE[setup.blank.kind === 'own' ? setup.blank.form : 'standard']));

/**
 * "Bewerbungsnachweis" on the Applications page (spec 0.15.0, 9.2): the new submitted applications, ticked; the file
 * is saved where the person chooses, and only then are they marked as exported (cancel / failure marks nothing).
 */
export function NachweisDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState<NachweisView | null>(null);
  const [personName, setPersonName] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [showExported, setShowExported] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // A second click while the "Save as" window opens must not start a second save (state updates come too late).
  const running = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const v = await api.nachweis.get();
      // The name must be there before the setup form first renders: the form takes its start values once.
      if (!v.setup) setPersonName((await api.getProfile()).profile.sections.personal.data.fullName);
      setView(v);
      setPicked(new Set(v.candidates.filter((c) => c.exportedAt === null).map((c) => c.packageId)));
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async (chosen: NachweisCandidate[]) => {
    if (running.current) return;
    running.current = true;
    setSaving(true);
    setDone(false);
    setError(null);
    try {
      const ids = chosen.map((c) => c.packageId);
      const name = nachweisFileName(chosen);
      const result = await saveFile({ suggestedName: name, kind: 'docx', make: api.nachweis.buildRequest(ids) });
      if (result === 'cancelled') return;
      const next = await api.nachweis.mark(ids, name);
      setView(next);
      setPicked(new Set(next.candidates.filter((c) => c.exportedAt === null).map((c) => c.packageId)));
      setDone(true);
      onChanged?.();
    } catch (err) {
      setError(err);
    } finally {
      running.current = false;
      setSaving(false);
    }
  };

  const header = (
    <div className="section-head">
      <h2>{t('nachweis.title')}</h2>
      <button type="button" className="btn ghost small" disabled={saving} onClick={onClose}>{t('nachweis.export.close')}</button>
    </div>
  );
  if (!view) {
    return <div className="card nachweis-dialog" role="dialog" aria-label={t('nachweis.title')}>{header}{error ? <ErrorBanner error={error} onRetry={() => void load()} /> : <p className="muted">{t('common.loading')}</p>}</div>;
  }
  if (!view.setup) {
    return (
      <div className="card nachweis-dialog" role="dialog" aria-label={t('nachweis.title')}>
        {header}
        <p>{t('nachweis.export.setupFirst')}</p>
        <NachweisSetupForm initial={null} personName={personName}
          onSaved={(p) => setView((v) => (v ? { ...v, setup: p.profile.nachweis } : v))} onCancel={onClose} />
      </div>
    );
  }

  const setup = view.setup;
  const fresh = view.candidates.filter((c) => c.exportedAt === null);
  const shown = showExported ? view.candidates : fresh;
  // Only what is on screen goes into the file: a row ticked and then hidden again stays out.
  const chosen = shown.filter((c) => picked.has(c.packageId));
  const unconfirmed = chosen.filter((c) => c.contactUnconfirmed);
  return (
    <div className="card nachweis-dialog" role="dialog" aria-label={t('nachweis.title')}>
      {header}
      {fresh.length === 0 ? <p>{t('nachweis.export.nothingNew')}</p> : null}
      {shown.length > 0 ? (
        <ul className="nachweis-list">
          {shown.map((c) => (
            <li key={c.packageId}>
              <label className="check">
                <input type="checkbox" checked={picked.has(c.packageId)} disabled={saving} onChange={() => toggle(c.packageId)} />
                <span>{germanDay(c.appliedAt)} · {c.company} — {c.title}</span>
              </label>
              {c.exportedAt ? <span className="badge event">{t('nachweis.export.exportedOn', { date: germanDay(c.exportedAt) })}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {view.candidates.length > fresh.length ? (
        <label className="check"><input type="checkbox" checked={showExported} disabled={saving} onChange={(e) => setShowExported(e.target.checked)} /> {t('nachweis.export.showExported')}</label>
      ) : null}
      {unconfirmed.length > 0 ? (
        <div className="notice">
          <p>{t('nachweis.export.unconfirmed', { count: unconfirmed.length })}</p>
          <ul>{unconfirmed.map((c) => <li key={c.packageId}><a href={`#/applications/${c.packageId}`}>{c.company}</a></li>)}</ul>
        </div>
      ) : null}
      {chosen.length > 0 ? <p className="muted">{t('nachweis.export.summary', { count: chosen.length, pages: pagesFor(setup, chosen.length) })}</p> : null}
      {done ? <p className="ok" role="status">{t('nachweis.export.saved')}</p> : null}
      {error ? <ErrorBanner error={error} /> : null}
      <div className="btn-row">
        <button type="button" className="btn" disabled={saving || chosen.length === 0} onClick={() => void save(chosen)}>
          {saving ? t('nachweis.export.saving') : t('nachweis.export.save')}
        </button>
      </div>
    </div>
  );
}
