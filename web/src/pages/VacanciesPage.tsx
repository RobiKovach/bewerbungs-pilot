import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchProgress } from '../vacancies/SearchProgress';
import { SearchStrip } from '../vacancies/SearchStrip';
import { useSearchStatus } from '../vacancies/useSearchStatus';
import { useVacancies, VacanciesProvider } from '../vacancies/VacanciesContext';
import { wishesComplete } from '../vacancies/wishes';

function VacanciesContent({ pollMs }: { pollMs?: number }) {
  const { t } = useTranslation();
  const { vacancies, wishes, reload } = useVacancies();
  const [, setAdding] = useState(false);
  const complete = wishesComplete(wishes);
  const status = useSearchStatus({ onTick: () => void reload(), pollMs });
  const searching = status.state?.state === 'running';
  return (
    <section>
      <h1>{t('vacancies.title')}</h1>
      {!complete ? (
        <div className="card readiness" role="status">
          <p>{t('vacancies.incomplete')}</p>
          <a className="btn" href="#/profile">{t('vacancies.fillWishes')}</a>
        </div>
      ) : null}
      <SearchStrip canSearch={complete} searching={searching} onSearch={() => void status.start()} onAdd={() => setAdding(true)} />
      <SearchProgress status={status} />
      {vacancies.length === 0 ? <p className="muted">{t('vacancies.empty')}</p> : (
        <ul className="plain-list">{vacancies.map((v) => <li key={v.id}>{v.title}</li>)}</ul>
      )}
    </section>
  );
}

export function VacanciesPage({ pollMs }: { pollMs?: number } = {}) {
  return <VacanciesProvider><VacanciesContent pollMs={pollMs} /></VacanciesProvider>;
}
