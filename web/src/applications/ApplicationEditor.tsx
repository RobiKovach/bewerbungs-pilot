import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import type { ApplicationView, DocLanguage } from '../types';
import { LetterTab } from './LetterTab';
import { jobError, useApplicationJob } from './useApplicationJob';

const TABS = ['letter'] as const;
type Tab = (typeof TABS)[number];

export function ApplicationEditor({ id, pollMs }: { id: string; pollMs?: number }) {
  const { t } = useTranslation();
  const [view, setView] = useState<ApplicationView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('letter');
  const [confirm, setConfirm] = useState<null | 'recreate' | 'delete'>(null);
  const [dirty, setDirty] = useState(false);
  const [language, setLanguage] = useState<DocLanguage>('de');

  const load = useCallback(async () => {
    try {
      setView(await api.getApplication(id));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const job = useApplicationJob({ pollMs, onFinished: (s) => { if (s.applicationId === id) void load(); } });

  if (error && !view) return <ErrorBanner error={error} onRetry={() => void load()} />;
  if (!view) return <p className="muted">{t('common.loading')}</p>;
  const a = view.application;
  // One job at a time: any running job switches the Claude buttons off; editing is off only for the package it works on.
  const busy = job.state?.state === 'running';
  const locked = busy && job.state?.applicationId === id;
  const failed = job.state?.applicationId === id ? jobError(job.state) : null;
  const act = async (fn: () => Promise<ApplicationView>) => {
    setActionError(null);
    try { setView(await fn()); } catch (err) { setActionError(err); }
  };
  const remove = async () => {
    setActionError(null);
    try {
      await api.deleteApplication(id);
      window.location.hash = '#/applications';
    } catch (err) {
      setActionError(err);
    }
  };

  return (
    <section className="app-editor">
      <p><a href="#/applications">{t('applications.back')}</a></p>
      <h1>{a.vacancy.company} — {a.vacancy.title}</h1>
      <p className="app-row__meta">
        <span className={`badge status-${a.status}`}>{t(`applications.status.${a.status}`)}</span>
        <span className="badge">{a.language.toUpperCase()}</span>
        {view.profileChanged ? <span className="badge warn">{t('applications.profileChanged')}</span> : null}
      </p>
      {busy && job.state?.kind ? <ClaudeWorking textKey={`applications.working.${job.state.kind}`} onCancel={() => void job.cancel()} /> : null}
      {failed ? <ErrorBanner error={failed} /> : null}
      {job.error ? <ErrorBanner error={job.error} /> : null}

      <div role="tablist" className="tabs">
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'tab active' : 'tab'} onClick={() => setTab(x)}>{t(`applications.tabs.${x}`)}</button>
        ))}
      </div>
      {tab === 'letter' ? (
        <LetterTab key={a.updatedAt} view={view} locked={locked} busy={busy} onView={setView} onDirty={setDirty} onRevise={(instruction) => void job.start(() => api.reviseLetter(id, instruction))} />
      ) : null}

      <div className="btn-row app-actions">
        {a.status === 'draft'
          ? <button type="button" className="btn" disabled={locked || dirty || a.letter.pages > 1} onClick={() => void act(() => api.approveApplication(id))}>{t('applications.approve')}</button>
          : <button type="button" className="btn ghost" disabled={locked || dirty} onClick={() => void act(() => api.unapproveApplication(id))}>{t('applications.unapprove')}</button>}
        <button type="button" className="btn ghost" disabled={busy} onClick={() => { setLanguage(a.language); setConfirm('recreate'); }}>{t('applications.recreate')}</button>
        <button type="button" className="btn ghost" disabled={locked} onClick={() => setConfirm('delete')}>{t('applications.delete')}</button>
      </div>
      {dirty ? <p className="muted">{t('applications.letter.saveFirst')}</p> : null}
      {confirm === 'recreate' ? (
        <div className="card notice" role="alertdialog" aria-label={t('applications.recreate')}>
          <p>{t('applications.recreateConfirm')}</p>
          <fieldset className="create-package__languages">
            <legend>{t('applications.create.language')}</legend>
            {(['de', 'en'] as const).map((l) => (
              <label key={l}><input type="radio" name="recreate-lang" checked={language === l} onChange={() => setLanguage(l)} /> {t(`applications.language.${l}`)}</label>
            ))}
          </fieldset>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => { setConfirm(null); void job.start(() => api.recreatePackage(id, language)); }}>{t('applications.recreateYes')}</button>
            <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : null}
      {confirm === 'delete' ? (
        <div className="card notice" role="alertdialog" aria-label={t('applications.delete')}>
          <p>{t('applications.deleteConfirm')}</p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => { setConfirm(null); void remove(); }}>{t('applications.deleteYes')}</button>
            <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : null}
      {actionError ? <ErrorBanner error={actionError} /> : null}
    </section>
  );
}
