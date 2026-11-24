import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import type { SimilarTitle } from '../types';

/**
 * "Suggest similar titles" (0.14.0): the AI helper proposes, the person ticks, only then titles are added to the wishes.
 * `free` = how many titles still fit into the wishes. `onAdd` answers false when saving failed (the list stays).
 */
export function SimilarTitles({ titles, free, disabled, onAdd }: { titles: readonly string[]; free: number; disabled: boolean; onAdd: (add: string[]) => Promise<boolean> }) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [list, setList] = useState<SimilarTitle[] | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const ctrl = useRef<AbortController | null>(null);
  // Leaving the page stops the AI request: nobody would see its answer.
  useEffect(() => () => ctrl.current?.abort(), []);

  const ask = async () => {
    const c = new AbortController();
    ctrl.current = c;
    setRunning(true);
    setError(null);
    setList(null);
    setChosen(new Set());
    try {
      setList((await api.similarTitles(c.signal)).titles);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(err);
    } finally {
      setRunning(false);
    }
  };
  const has = new Set(titles.map((x) => x.trim().toLowerCase()));
  // A title added by hand meanwhile is no proposal any more.
  const open = (list ?? []).filter((s) => !has.has(s.title.toLowerCase()));
  const picked = open.filter((s) => chosen.has(s.title));
  const toggle = (title: string) => setChosen((old) => {
    const next = new Set(old);
    if (!next.delete(title)) next.add(title);
    return next;
  });
  const add = async () => {
    if (await onAdd(picked.map((s) => s.title))) { setList(null); setChosen(new Set()); }
  };

  return (
    <div className="similar-titles">
      {running ? (
        <div className="btn-row">
          <span className="muted" role="status">{t('vacancies.similar.running')}</span>
          <button type="button" className="btn small ghost" onClick={() => ctrl.current?.abort()}>{t('common.cancel')}</button>
        </div>
      ) : list === null ? (
        <button type="button" className="btn small ghost" disabled={disabled || free <= 0} onClick={() => void ask()}>{t('vacancies.similar.ask')}</button>
      ) : open.length === 0 ? (
        <p className="muted" role="status">{t('vacancies.similar.none')}</p>
      ) : (
        <fieldset className="similar-titles__list">
          <legend>{t('vacancies.similar.title')}</legend>
          {open.map((s) => (
            <label key={s.title} className="check">
              <input type="checkbox" checked={chosen.has(s.title)} disabled={disabled || (!chosen.has(s.title) && picked.length >= free)} onChange={() => toggle(s.title)} />{' '}
              <span><strong>{s.title}</strong> <span className="muted">— {s.why}</span></span>
            </label>
          ))}
          <div className="btn-row">
            <button type="button" className="btn small" disabled={disabled || picked.length === 0} onClick={() => void add()}>{t('vacancies.similar.add', { count: picked.length })}</button>
            <button type="button" className="btn small ghost" onClick={() => setList(null)}>{t('common.dismiss')}</button>
          </div>
        </fieldset>
      )}
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
