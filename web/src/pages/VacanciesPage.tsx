import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { MissingList } from '../applications/CreatePackageDialog';
import { packageLinks, submittedByVacancy, type SubmittedPackage } from '../applications/format';
import { PackageButton, READINESS_NOTE_ID } from '../applications/PackageButton';
import { ManualAdd } from '../vacancies/ManualAdd';
import { ManualEdit } from '../vacancies/ManualEdit';
import { SearchProgress } from '../vacancies/SearchProgress';
import { SearchStrip } from '../vacancies/SearchStrip';
import { tabOf, type Tab } from '../vacancies/sort';
import { useSearchStatus } from '../vacancies/useSearchStatus';
import { useVacancies, VacanciesProvider } from '../vacancies/VacanciesContext';
import { VacancyList } from '../vacancies/VacancyList';
import { wishesComplete } from '../vacancies/wishes';
import type { ManualNotice, PackageReadiness, Vacancy, VacancyStatus } from '../types';

function VacanciesContent({ pollMs, toastMs }: { pollMs?: number; toastMs?: number }) {
  const { t } = useTranslation();
  const { vacancies, wishes, reload } = useVacancies();
  const [adding, setAdding] = useState(false);
  // What the last hand-added offer could not read (a PDF from the note) — shown until closed or the next add (0.9.1).
  const [addNotices, setAddNotices] = useState<ManualNotice[]>([]);
  const [tab, setTab] = useState<Tab>('new');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; checkHint: boolean } | null>(null);
  const [readiness, setReadiness] = useState<PackageReadiness | null>(null);
  useEffect(() => {
    let alive = true;
    api.packageReadiness().then((r) => { if (alive) setReadiness(r); }, () => undefined);
    return () => { alive = false; };
  }, []);
  const [packages, setPackages] = useState<Map<string, { id: string; editable: boolean }>>(new Map());
  const [submitted, setSubmitted] = useState<ReadonlyMap<string, SubmittedPackage>>(new Map());
  useEffect(() => {
    let alive = true;
    api.listApplications().then((l) => {
      if (!alive) return;
      setPackages(packageLinks(l.applications));
      setSubmitted(submittedByVacancy(l.applications));
    }, () => undefined);
    return () => { alive = false; };
  }, []);
  const manualExtra = (v: Vacancy) => (v.source !== 'manual' ? null : editing?.id === v.id
    ? <ManualEdit vacancy={v} checkHint={editing.checkHint} onDone={() => setEditing(null)} />
    : <div className="btn-row"><button type="button" className="btn small ghost" onClick={() => setEditing({ id: v.id, checkHint: false })}>{t('vacancies.edit.open')}</button></div>);
  const complete = wishesComplete(wishes);
  const status = useSearchStatus({ onTick: () => void reload(), pollMs });
  const searching = status.state?.state === 'running';
  const submittedPackage = (v: Vacancy) => (v.status !== 'hidden' ? submitted.get(v.id)?.applicationId ?? null : null);
  const showCard = (v: { id: string; status: VacancyStatus }) => { setTab(tabOf(v, submitted)); setFocusId(v.id); };
  return (
    <section>
      <h1>{t('vacancies.title')}</h1>
      {!complete ? (
        <div className="card readiness" role="status">
          <p>{t('vacancies.incomplete')}</p>
          <a className="btn" href="#/profile">{t('vacancies.fillWishes')}</a>
        </div>
      ) : null}
      <SearchStrip canSearch={complete} searching={searching} onSearch={() => void status.start()} onAdd={() => { setAddNotices([]); setAdding(true); }} />
      <SearchProgress status={status} />
      {adding ? (
        <ManualAdd
          onClose={() => setAdding(false)}
          onAdded={(v: Vacancy, notices: ManualNotice[]) => { setAdding(false); setAddNotices(notices); showCard(v); if (v.source === 'manual') setEditing({ id: v.id, checkHint: true }); }}
          onShow={(v) => { setAdding(false); showCard(v); }}
        />
      ) : null}
      {addNotices.length > 0 ? (
        <div className="card notice notice-warn manual-notices" role="status">
          {addNotices.map((n) => <p key={n}>{t(`vacancies.manual.notices.${n}`)}</p>)}
          <div className="btn-row"><button type="button" className="btn small ghost" onClick={() => setAddNotices([])}>{t('vacancies.manual.closeNotice')}</button></div>
        </div>
      ) : null}
      {readiness && !readiness.ready && vacancies.some((v) => tabOf(v, submitted) === 'favorite' && !packages.get(v.id)?.editable) ? <div className="card readiness"><MissingList readiness={readiness} id={READINESS_NOTE_ID} /></div> : null}
      {vacancies.length === 0 ? <p className="muted">{t('vacancies.empty')}</p> : (
        <VacancyList tab={tab} onTab={setTab} focusId={focusId} toastMs={toastMs} submitted={submitted}
          renderExtra={(v) => (
            <>
              {/* In "Submitted" every card opens the package the badge is about, whatever the vacancy's stored status. */}
              {submittedPackage(v) ? <div className="btn-row"><a className="btn" href={`#/applications/${submittedPackage(v)}`}>{t('applications.open')}</a></div>
                : v.status === 'favorite' ? <PackageButton vacancy={v} existing={packages.get(v.id) ?? null} readiness={readiness} pollMs={pollMs} /> : null}
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
