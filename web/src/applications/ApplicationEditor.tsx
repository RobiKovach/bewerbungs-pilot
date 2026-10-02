import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import type { ApplicationView, DocLanguage } from '../types';
import { AttachmentsTab } from './AttachmentsTab';
import { CvTab } from './CvTab';
import { download } from './download';
import { LetterTab } from './LetterTab';
import { jobError, useApplicationJob } from './useApplicationJob';

const TABS = ['letter', 'cv', 'attachments'] as const;
type Tab = (typeof TABS)[number];

export function ApplicationEditor({ id, pollMs }: { id: string; pollMs?: number }) {
  const { t } = useTranslation();
  const [view, setView] = useState<ApplicationView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('letter');
  const [confirm, setConfirm] = useState<null | 'recreate' | 'delete'>(null);
  const [letterDirty, setLetterDirty] = useState(false);
  const [cvDirty, setCvDirty] = useState(false);
  const [downloading, setDownloading] = useState(false);
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
  // Unsaved text in the letter or the CV Profil: Approve, Back to draft and tab switches wait until it is saved or discarded.
  const dirty = letterDirty || cvDirty;
  // One job at a time: any running job switches the Claude buttons off; editing is off only for the package it works on.
  const busy = job.state?.state === 'running';
  const jobOnThis = busy && job.state?.applicationId === id;
  // A failed reload (after a job or a refused approve) leaves a stale view: editing stays off until a reload succeeds.
  const locked = jobOnThis || error !== null;
  const failed = job.state?.applicationId === id ? jobError(job.state) : null;
  const act = async (fn: () => Promise<ApplicationView>) => {
    setActionError(null);
    try {
      setView(await fn());
    } catch (err) {
      setActionError(err);
      // The server counted the pages itself: show its number (red mark) instead of the stale view.
      if (err instanceof ApiError && err.code === 'LETTER_TOO_LONG') void load();
    }
  };
  const save = async (url: string, name: string) => {
    setDownloading(true);
    setActionError(null);
    try { await download(url, name); } catch (err) { setActionError(err); } finally { setDownloading(false); }
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
      {jobOnThis && job.state?.kind
        ? <ClaudeWorking textKey={`applications.working.${job.state.kind}`} onCancel={() => void job.cancel()} />
        : busy ? <p className="muted" role="status">{t('applications.busy')}</p> : null}
      {error ? <ErrorBanner error={error} onRetry={() => void load()} /> : null}
      {failed ? <ErrorBanner error={failed} /> : null}
      {job.error ? <ErrorBanner error={job.error} /> : null}

      <div role="tablist" className="tabs">
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'tab active' : 'tab'} disabled={dirty && tab !== x} onClick={() => setTab(x)}>{t(`applications.tabs.${x}`)}</button>
        ))}
      </div>
      {tab === 'letter' ? (
        <LetterTab key={a.updatedAt} view={view} locked={locked} busy={busy} onView={setView} onDirty={setLetterDirty} onRevise={(instruction) => void job.start(() => api.reviseLetter(id, instruction))} />
      ) : null}
      {tab === 'cv' ? <CvTab key={a.updatedAt} view={view} locked={locked} busy={busy} onView={setView} onDirty={setCvDirty} onRefresh={(keep) => void job.start(() => api.refreshCv(id, keep))} /> : null}
      {tab === 'attachments' ? <AttachmentsTab view={view} locked={locked} onView={setView} /> : null}

      <div className="btn-row downloads" role="group" aria-label={t('applications.download.title')}>
        <button type="button" className="btn ghost" disabled={downloading || dirty} onClick={() => void save(api.pdfUrl(id, 'letter'), 'Anschreiben.pdf')}>{t('applications.download.letter')}</button>
        <button type="button" className="btn ghost" disabled={downloading || dirty} onClick={() => void save(api.pdfUrl(id, 'cv'), 'Lebenslauf.pdf')}>{t('applications.download.cv')}</button>
        {view.attachments.filter((x) => x.selected && !x.missing).map((x) => (
          <button key={x.id} type="button" className="btn ghost" disabled={downloading || dirty} onClick={() => void save(api.attachmentUrl(id, x.id), `${x.label || 'Anlage'}.pdf`)}>{t('applications.download.attachment', { name: x.label })}</button>
        ))}
        <button type="button" className="btn" disabled={downloading || dirty} onClick={() => void save(api.pdfUrl(id, 'bundle'), 'Bewerbung.pdf')}>{t('applications.download.bundle')}</button>
      </div>

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
