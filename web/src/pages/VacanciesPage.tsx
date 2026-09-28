import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchProgress } from '../vacancies/SearchProgress';
import { SearchStrip } from '../vacancies/SearchStrip';
import type { Tab } from '../vacancies/sort';
import { useSearchStatus } from '../vacancies/useSearchStatus';
import { useVacancies, VacanciesProvider } from '../vacancies/VacanciesContext';
import { VacancyList } from '../vacancies/VacancyList';
import { wishesComplete } from '../vacancies/wishes';

function VacanciesContent({ pollMs, toastMs }: { pollMs?: number; toastMs?: number }) {
  const { t } = useTranslation();
  const { vacancies, wishes, reload } = useVacancies();
  const [, setAdding] = useState(false);
  const [tab, setTab] = useState<Tab>('new');
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
        <VacancyList tab={tab} onTab={setTab} toastMs={toastMs} />
      )}
    </section>
  );
}

export function VacanciesPage({ pollMs, toastMs }: { pollMs?: number; toastMs?: number } = {}) {
  return <VacanciesProvider><VacanciesContent pollMs={pollMs} toastMs={toastMs} /></VacanciesProvider>;
}
