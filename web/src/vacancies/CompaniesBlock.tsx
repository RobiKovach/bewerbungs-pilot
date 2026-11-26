import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import type { CompanyView } from '../types';

const MAX = 20;

/**
 * "Companies I follow" (0.14.0): careers pages on Greenhouse, Lever, Ashby or Personio. The search reads each of them
 * once (at most every 6 hours); adding reads the page once to be sure it exists. Removing keeps the cards already found.
 */
export function CompaniesBlock({ disabled }: { disabled: boolean }) {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<CompanyView[] | null>(null);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'add' | string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => {
    let alive = true;
    api.listCompanies().then((r) => { if (alive) setList(r.companies); }, (err: unknown) => { if (alive) setError(err); });
    return () => { alive = false; ctrl.current?.abort(); };
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const c = new AbortController();
    ctrl.current = c;
    setBusy('add');
    setError(null);
    try {
      setList((await api.addCompany(url.trim(), name.trim(), c.signal)).companies);
      setUrl('');
      setName('');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(err);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      setList((await api.removeCompany(id)).companies);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  const date = (iso: string) => new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const full = (list?.length ?? 0) >= MAX;

  return (
    <details className="card companies">
      <summary><strong>{t('vacancies.companies.title')}</strong>{list && list.length > 0 ? <span className="muted"> ({list.length})</span> : null}</summary>
      <p className="muted">{t('vacancies.companies.intro')}</p>
      {list && list.length > 0 ? (
        <ul className="companies__list">
          {list.map((c) => (
            <li key={c.id}>
              <div>
                <strong>{c.name}</strong> <span className="badge">{t(`vacancies.companies.service.${c.service}`)}</span>{' '}
                <a href={c.url} target="_blank" rel="noopener noreferrer">{t('vacancies.companies.open')}</a>
              </div>
              <div className="muted">
                {c.lastReadFailed ? <span className="companies__failed">{t('vacancies.companies.failed')}</span>
                  : c.lastReadAt ? t('vacancies.companies.lastRead', { date: date(c.lastReadAt) }) : t('vacancies.companies.notRead')}
                {c.offers !== null && !c.lastReadFailed ? <> · {t('vacancies.companies.offers', { count: c.offers })}</> : null}
              </div>
              <div className="btn-row">
                <button type="button" className="btn small ghost" disabled={disabled || busy !== null} onClick={() => void remove(c.id)}
                  aria-label={t('vacancies.companies.removeOne', { name: c.name })}>{t('vacancies.companies.remove')}</button>
              </div>
            </li>
          ))}
        </ul>
      ) : list ? <p className="muted">{t('vacancies.companies.empty')}</p> : null}
      {full ? <p className="muted" role="status">{t('vacancies.companies.full', { max: MAX })}</p> : (
        <form className="companies__add" onSubmit={(e) => void add(e)}>
          <label className="field">
            <span className="field-head">{t('vacancies.companies.link')}</span>
            <input type="url" value={url} maxLength={2000} required placeholder="https://jobs.lever.co/…" disabled={busy === 'add'} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-head">{t('vacancies.companies.name')}</span>
            <input type="text" value={name} maxLength={120} required disabled={busy === 'add'} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="field-hint">{t('vacancies.companies.supported')}</p>
          <div className="btn-row">
            {busy === 'add' ? (
              <>
                <span className="muted" role="status">{t('vacancies.companies.adding')}</span>
                <button type="button" className="btn small ghost" onClick={() => ctrl.current?.abort()}>{t('common.cancel')}</button>
              </>
            ) : (
              <button type="submit" className="btn small" disabled={disabled || busy !== null || !url.trim() || !name.trim()}>{t('vacancies.companies.add')}</button>
            )}
          </div>
        </form>
      )}
      {error ? <ErrorBanner error={error} /> : null}
    </details>
  );
}
