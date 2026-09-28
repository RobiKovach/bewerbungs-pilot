import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchStrip } from '../vacancies/SearchStrip';
import { useVacancies, VacanciesProvider } from '../vacancies/VacanciesContext';
import { wishesComplete } from '../vacancies/wishes';

function VacanciesContent() {
  const { t } = useTranslation();
  const { vacancies, wishes } = useVacancies();
  const [, setAdding] = useState(false);
  const complete = wishesComplete(wishes);
  return (
    <section>
      <h1>{t('vacancies.title')}</h1>
      {!complete ? (
        <div className="card readiness" role="status">
          <p>{t('vacancies.incomplete')}</p>
          <a className="btn" href="#/profile">{t('vacancies.fillWishes')}</a>
        </div>
      ) : null}
      <SearchStrip canSearch={complete} searching={false} onSearch={() => {}} onAdd={() => setAdding(true)} />
      {vacancies.length === 0 ? <p className="muted">{t('vacancies.empty')}</p> : (
        <ul className="plain-list">{vacancies.map((v) => <li key={v.id}>{v.title}</li>)}</ul>
      )}
    </section>
  );
}

export function VacanciesPage() {
  return <VacanciesProvider><VacanciesContent /></VacanciesProvider>;
}
