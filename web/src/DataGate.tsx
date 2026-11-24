import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { UpdateBanner } from './components/UpdateBanner';
import { BackupsSection } from './settings/BackupsSection';
import type { DataProblem } from './types';

const RELEASES = 'https://github.com/RobiKovach/bewerbungs-pilot/releases/latest';

/** The data is from a newer app version (0.13.4): only "update" or "restore an older backup" — never an empty-looking app. */
function NewerDataScreen() {
  const { t } = useTranslation();
  return (
    <div className="app">
      <UpdateBanner />
      <main className="content">
        <LanguageSwitcher />
        <section className="card">
          <h1>{t('dataState.newerTitle')}</h1>
          <p>{t('dataState.newerText')}</p>
          <p><a className="btn" href={RELEASES} target="_blank" rel="noreferrer">{t('dataState.newerDownload')}</a></p>
        </section>
        <section className="card">
          <h2>{t('dataState.newerRestore')}</h2>
          <BackupsSection onRestored={() => window.location.reload()} />
        </section>
      </main>
    </div>
  );
}

/** Asks once when the app opens; while it is unknown (or cannot be asked) the app is shown as usual. */
export function DataGate({ children }: { children: ReactNode }) {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    let alive = true;
    api.getDataState().then((s) => { if (alive && s.newer === true) setNewer(true); }, () => undefined);
    return () => { alive = false; };
  }, []);
  return newer ? <NewerDataScreen /> : <>{children}</>;
}

/** Some data could not be read and was put aside: say so, with the way to the backups. */
export function DataNotice() {
  const { t } = useTranslation();
  const [problems, setProblems] = useState<DataProblem[]>([]);
  useEffect(() => {
    let alive = true;
    api.getDataState().then((s) => { if (alive && Array.isArray(s.problems)) setProblems(s.problems); }, () => undefined);
    return () => { alive = false; };
  }, []);
  if (problems.length === 0) return null;
  const dismiss = () => {
    setProblems([]);
    void api.dismissDataProblems().catch(() => undefined);
  };
  return (
    <aside className="notice notice-warn dismissible" role="alert">
      <button type="button" className="notice-close" aria-label={t('common.dismiss')} title={t('common.dismiss')} onClick={dismiss}>×</button>
      <p><strong>{t('dataState.problemTitle')}</strong></p>
      <p>{t('dataState.problemText', { what: problems.map((p) => t(`dataState.${p}`)).join(', ') })}</p>
      <p><a href="#/settings">{t('dataState.problemLink')}</a></p>
    </aside>
  );
}
