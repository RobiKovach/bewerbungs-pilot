import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { formatDay } from '../applications/format';
import { ErrorBanner } from '../components/ErrorBanner';
import type { ApplicationListView } from '../types';

export function applicationIdFromHash(hash: string): string | null {
  const m = /^#\/applications\/([A-Za-z0-9_-]{1,64})$/.exec(hash);
  return m ? m[1] : null;
}

function ApplicationList() {
  const { t } = useTranslation();
  const [list, setList] = useState<ApplicationListView['applications'] | null>(null);
  const [error, setError] = useState<unknown>(null);
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
        <ul className="app-list">
          {list.map((a) => (
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
      )}
    </section>
  );
}

export function ApplicationsPage() {
  return <ApplicationList />;
}
