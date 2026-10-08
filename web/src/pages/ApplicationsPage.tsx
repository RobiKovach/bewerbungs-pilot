import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ApplicationEditor } from '../applications/ApplicationEditor';
import { formatDay } from '../applications/format';
import { ErrorBanner } from '../components/ErrorBanner';
import type { ApplicationListView, ApplicationStatus } from '../types';

const FILTERS = [
  { id: 'all', statuses: null },
  { id: 'draft', statuses: ['draft'] },
  { id: 'approved', statuses: ['approved'] },
  { id: 'sent', statuses: ['sent', 'submitted'] },
  { id: 'interview', statuses: ['interview'] },
  { id: 'rejected', statuses: ['rejected'] },
  { id: 'offer', statuses: ['offer'] },
  { id: 'withdrawn', statuses: ['withdrawn'] },
] as const satisfies readonly { id: string; statuses: readonly ApplicationStatus[] | null }[];
type FilterId = (typeof FILTERS)[number]['id'];

export function applicationIdFromHash(hash: string): string | null {
  const m = /^#\/applications\/([A-Za-z0-9_-]{1,64})$/.exec(hash);
  return m ? m[1] : null;
}

function ApplicationList() {
  const { t } = useTranslation();
  const [list, setList] = useState<ApplicationListView['applications'] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<FilterId>('all');
  const load = useCallback(async () => {
    try {
      setList((await api.listApplications()).applications);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error && !list) return <ErrorBanner error={error} onRetry={() => void load()} />;
  if (!list) return <p className="muted">{t('common.loading')}</p>;
  const inFilter = (f: (typeof FILTERS)[number], status: ApplicationStatus) => f.statuses === null || (f.statuses as readonly string[]).includes(status);
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const shown = list.filter((a) => inFilter(active, a.status));
  return (
    <section>
      <h1>{t('applications.title')}</h1>
      <p className="muted">{t('applications.intro')}</p>
      {list.length === 0 ? (
        <div className="card">
          <p>{t('applications.empty')}</p>
          <a className="btn" href="#/vacancies">{t('applications.toVacancies')}</a>
        </div>
      ) : (
        <>
        <div role="radiogroup" aria-label={t('applications.filter.label')} className="filter-chips">
          {FILTERS.map((f) => (
            <label key={f.id} className={filter === f.id ? 'chip active' : 'chip'}>
              <input type="radio" name="app-filter" value={f.id} checked={filter === f.id} onChange={() => setFilter(f.id)} />
              {t(`applications.filter.${f.id}`)} ({list.filter((a) => inFilter(f, a.status)).length})
            </label>
          ))}
        </div>
        {shown.length === 0 ? <p className="muted">{t('applications.filter.none')}</p> : null}
        <ul className="app-list">
          {shown.map((a) => (
            <li key={a.id} className="card app-row">
              <a href={`#/applications/${a.id}`}><strong>{a.company}</strong> — {a.title}</a>
              <span className="app-row__meta">
                <span className={`badge status-${a.status}`}>{t(`applications.status.${a.status}`)}</span>
                <span className="badge">{a.language.toUpperCase()}</span>
                {a.profileChanged ? <span className="badge warn">{t('applications.profileChanged')}</span> : null}
                <span className="muted">{t('applications.updated', { date: formatDay(a.updatedAt) })}</span>
              </span>
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  );
}

export function ApplicationsPage({ pollMs }: { pollMs?: number } = {}) {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const id = applicationIdFromHash(hash);
  return id ? <ApplicationEditor key={id} id={id} pollMs={pollMs} /> : <ApplicationList />;
}
