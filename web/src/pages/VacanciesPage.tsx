import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { PackageButton } from '../applications/PackageButton';
import { ManualAdd } from '../vacancies/ManualAdd';
import { ManualEdit } from '../vacancies/ManualEdit';
import { SearchProgress } from '../vacancies/SearchProgress';
import { SearchStrip } from '../vacancies/SearchStrip';
import type { Tab } from '../vacancies/sort';
import { useSearchStatus } from '../vacancies/useSearchStatus';
import { useVacancies, VacanciesProvider } from '../vacancies/VacanciesContext';
import { VacancyList } from '../vacancies/VacancyList';
import { wishesComplete } from '../vacancies/wishes';
import type { Vacancy, VacancyStatus } from '../types';

function VacanciesContent({ pollMs, toastMs }: { pollMs?: number; toastMs?: number }) {
  const { t } = useTranslation();
  const { vacancies, wishes, reload } = useVacancies();
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<Tab>('new');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; checkHint: boolean } | null>(null);
  const [packages, setPackages] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    api.listApplications().then((l) => { if (alive) setPackages(new Map(l.applications.map((a) => [a.vacancyId, a.id]))); }, () => undefined);
    return () => { alive = false; };
  }, []);
  const manualExtra = (v: Vacancy) => (v.source !== 'manual' ? null : editing?.id === v.id
    ? <ManualEdit vacancy={v} checkHint={editing.checkHint} onDone={() => setEditing(null)} />
    : <div className="btn-row"><button type="button" className="btn small ghost" onClick={() => setEditing({ id: v.id, checkHint: false })}>{t('vacancies.edit.open')}</button></div>);
  const complete = wishesComplete(wishes);
  const status = useSearchStatus({ onTick: () => void reload(), pollMs });
  const searching = status.state?.state === 'running';
  const showCard = (v: { id: string; status: VacancyStatus }) => { setTab(v.status as Tab); setFocusId(v.id); };
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
      {adding ? (
        <ManualAdd
          onClose={() => setAdding(false)}
          onAdded={(v: Vacancy) => { setAdding(false); showCard(v); if (v.source === 'manual') setEditing({ id: v.id, checkHint: true }); }}
          onShow={(v) => { setAdding(false); showCard(v); }}
        />
      ) : null}
      {vacancies.length === 0 ? <p className="muted">{t('vacancies.empty')}</p> : (
        <VacancyList tab={tab} onTab={setTab} focusId={focusId} toastMs={toastMs}
          renderExtra={(v) => (
            <>
              {v.status === 'favorite' ? <PackageButton vacancy={v} existingId={packages.get(v.id) ?? null} pollMs={pollMs} /> : null}
              {manualExtra(v)}
            </>
          )} />
      )}
    </section>
  );
}

export function VacanciesPage({ pollMs, toastMs }: { pollMs?: number; toastMs?: number } = {}) {
  return <VacanciesProvider><VacanciesContent pollMs={pollMs} toastMs={toastMs} /></VacanciesProvider>;
}
