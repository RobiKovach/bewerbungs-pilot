import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { ConnectionLost } from '../components/ConnectionLost';
import { ErrorBanner } from '../components/ErrorBanner';
import { WrittenBy } from '../components/WrittenBy';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import { useReportUnsaved } from '../profile/unsaved';
import type { ApplicationView, DocLanguage, LetterPatch, UnsavedPackageText } from '../types';
import { AttachmentsTab } from './AttachmentsTab';
import { ContactDialog } from './ContactDialog';
import { CvTab } from './CvTab';
import { isStale } from './dialog';
import { download } from './download';
import { isFrozen } from './format';
import { FollowUpNotice } from './FollowUpNotice';
import { HistoryBlock } from './HistoryBlock';
import { LetterTab } from './LetterTab';
import { MailDraftDialog } from './MailDraftDialog';
import { OfferReplyDialog } from './OfferReplyDialog';
import { PersonalDataWarning } from './PersonalDataWarning';
import { SendDialog } from './SendDialog';
import { StatusDialog } from './StatusDialog';
import { jobError, useApplicationJob } from './useApplicationJob';
import { usePackageCheck } from './useTextCheck';

const TABS = ['letter', 'cv', 'attachments'] as const;
/** The package's link is the Arbeitsagentur offer itself (always so for AA offers since 0.9.1): the AA page can be opened. */
const AA_OFFER = /^https:\/\/www\.arbeitsagentur\.de\/jobsuche\/jobdetail\//;
type Tab = (typeof TABS)[number];

export function ApplicationEditor({ id, pollMs }: { id: string; pollMs?: number }) {
  const { t } = useTranslation();
  const [view, setView] = useState<ApplicationView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('letter');
  const [confirm, setConfirm] = useState<null | 'recreate' | 'delete' | 'submitted'>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [letterDirty, setLetterDirty] = useState(false);
  const [cvDirty, setCvDirty] = useState(false);
  useReportUnsaved(letterDirty || cvDirty);
  // Unsaved letter / CV text: the yellow personal-data block follows typing, like in the mail windows.
  const [letterUnsaved, setLetterUnsaved] = useState<LetterPatch | null>(null);
  const [cvUnsaved, setCvUnsaved] = useState<UnsavedPackageText | null>(null);
  const unsaved = letterUnsaved || cvUnsaved ? { ...(letterUnsaved ? { letter: letterUnsaved } : {}), ...cvUnsaved } : null;
  const [downloading, setDownloading] = useState(false);
  const [language, setLanguage] = useState<DocLanguage>('de');
  // 'noPassword' = connected, but the saved password is missing or cannot be read here (other PC or Windows account).
  const [mailState, setMailState] = useState<'none' | 'noPassword' | 'ready'>('none');
  const mailReady = mailState === 'ready';
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [reminding, setReminding] = useState(false);
  // The reply to a rejection (mail window), or to an offer: the text window, then the mail window for it.
  const [replying, setReplying] = useState<null | 'rejection' | 'offerText' | 'offerMail'>(null);
  // "Find contact" (0.9.1): the dialog, and "the approved letter went back to draft because the contact changed".
  const [contactOpen, setContactOpen] = useState(false);
  const [contactChanged, setContactChanged] = useState(false);

  const load = useCallback(async () => {
    try {
      let v = await api.getApplication(id);
      // A stored page count other than 1 may be stale (counted with an older layout, or 0 = not counted): count again.
      if (!isFrozen(v.application.status) && v.application.letter.pages !== 1) {
        try { v = await api.recountPages(id); } catch { /* no browser or busy: keep the stored number */ }
      }
      setView(v);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let alive = true;
    api.getMail().then(
      (m) => { if (alive) setMailState(m.mail === null ? 'none' : m.passwordSaved ? 'ready' : 'noPassword'); },
      () => { if (alive) setMailState('none'); },
    );
    return () => { alive = false; };
  }, []);
  // The send window belongs to an approved package: it closes when the package changes (e.g. "Back to draft" behind it).
  const status = view?.application.status;
  useEffect(() => { if (status !== 'approved') setSending(false); }, [status]);
  // Reply windows belong to a rejection / an offer: they close when the status changes (e.g. "Undo").
  useEffect(() => { if (status !== 'rejected' && status !== 'offer') setReplying(null); }, [status]);
  // The "approve again" note belongs to the draft it made: gone once the package is approved (or sent) again.
  useEffect(() => { if (status !== 'draft') setContactChanged(false); }, [status]);
  // The contact window belongs to an editable package: closed for good once it is sent (it never comes back by itself).
  useEffect(() => { if (status && isFrozen(status)) setContactOpen(false); }, [status]);
  const warnings = usePackageCheck(id, unsaved, view?.warnings ?? []);
  const job = useApplicationJob({ pollMs, onFinished: (s) => { if (s.applicationId === id) void load(); } });

  if (error && !view) return <ErrorBanner error={error} onRetry={() => void load()} />;
  if (!view) return <p className="muted">{t('common.loading')}</p>;
  const a = view.application;
  const frozen = isFrozen(a.status);
  // Unsaved text in the letter or the CV Profil: Approve, Back to draft and tab switches wait until it is saved or discarded.
  const dirty = letterDirty || cvDirty;
  // One job at a time: any running job switches the Claude buttons off; editing is off only for the package it works on.
  const busy = job.state?.state === 'running';
  const jobOnThis = busy && job.state?.applicationId === id;
  // A failed reload (after a job or a refused approve) leaves a stale view: editing stays off until a reload succeeds.
  const locked = jobOnThis || error !== null || frozen;
  const failed = job.state?.applicationId === id ? jobError(job.state) : null;
  // Copy or undo refused because this offer already has an unsent package: say so plainly and link to it.
  const draftExistsId = actionError instanceof ApiError && actionError.reason === 'draftExists' && actionError.params?.id
    ? String(actionError.params.id) : null;
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
  const copyAsDraft = async () => {
    setActionError(null);
    try {
      const v = await api.copyApplication(id);
      window.location.hash = `#/applications/${v.application.id}`;
    } catch (err) {
      setActionError(err);
    }
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

  // A mail window is open: everything above it is out of reach (no editing, sending or status changes behind it).
  const mailOpen = (sending && a.status === 'approved') || reminding || replying !== null || (contactOpen && !frozen);
  const saveContact = async (contact: Parameters<typeof api.saveApplicationContact>[1]) => {
    const wasApproved = a.status === 'approved';
    try {
      const v = await api.saveApplicationContact(id, contact);
      setView(v);
      setContactOpen(false);
      setActionError(null);
      setContactChanged(wasApproved && v.application.status === 'draft');
    } catch (err) {
      // Sent or changed meanwhile: the window closes, the editor shows the package as it is now and why.
      if (isStale(err)) { setContactOpen(false); setActionError(err); void load(); return; }
      throw err;
    }
  };
  return (
    <section className="app-editor">
      <div inert={mailOpen} className={mailOpen ? 'behind-dialog' : undefined}>
      <p><a href="#/applications">{t('applications.back')}</a></p>
      <h1>{a.vacancy.company} — {a.vacancy.title}</h1>
      <p className="app-row__meta">
        <span className={`badge status-${a.status}`}>{t(`applications.status.${a.status}`)}</span>
        <span className="badge">{a.language.toUpperCase()}</span>
        <WrittenBy provider={a.writtenBy} kind="package" />
        {view.profileChanged && !frozen ? <span className="badge warn">{t('applications.profileChanged')}</span> : null}
      </p>
      {jobOnThis && job.state?.kind
        ? <ClaudeWorking textKey={`applications.working.${job.state.kind}`} onCancel={() => void job.cancel()} />
        : busy ? <p className="muted" role="status">{t('applications.busy')}</p> : null}
      {frozen ? <p className="notice" role="status">{t('applications.frozen')}</p> : null}
      {sentTo ? <p className="notice notice-ok" role="status">{t('applications.send.sentNotice', { to: sentTo })}</p> : null}
      {contactChanged && a.status === 'draft' ? <p className="notice" role="status">{t('contact.changed')}</p> : null}
      {view.followUpDue && !reminding ? (
        <FollowUpNotice history={a.history} busy={busy || error !== null} onWrite={() => { setSentTo(null); setReminding(true); }} onDismiss={() => void act(() => api.dismissFollowUp(id))} />
      ) : null}
      {error ? <ErrorBanner error={error} onRetry={() => void load()} /> : null}
      {failed ? <ErrorBanner error={failed} /> : null}
      {job.error ? <ErrorBanner error={job.error} /> : null}
      {job.lost ? <ConnectionLost onRetry={job.recheck} /> : null}

      <div role="tablist" className="tabs">
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'tab active' : 'tab'} disabled={dirty && tab !== x} onClick={() => setTab(x)}>{t(`applications.tabs.${x}`)}</button>
        ))}
      </div>
      {tab === 'letter' ? (
        <LetterTab key={a.updatedAt} view={view} locked={locked} frozen={frozen} busy={busy} onView={setView} onDirty={setLetterDirty} onUnsaved={setLetterUnsaved} onRevise={(instruction) => void job.start(() => api.reviseLetter(id, instruction))} />
      ) : null}
      {tab === 'cv' ? <CvTab key={a.updatedAt} view={view} locked={locked} frozen={frozen} busy={busy} onView={setView} onDirty={setCvDirty} onUnsaved={setCvUnsaved} onRefresh={(keepProfil, keepHeadline) => void job.start(() => api.refreshCv(id, keepProfil, keepHeadline))} /> : null}
      {tab === 'attachments' ? <AttachmentsTab view={view} locked={locked} onView={setView} /> : null}

      <div className="btn-row downloads" role="group" aria-label={t('applications.download.title')}>
        <button type="button" className="btn ghost" disabled={downloading || dirty} onClick={() => void save(api.pdfUrl(id, 'letter'), 'Anschreiben.pdf')}>{t('applications.download.letter')}</button>
        <button type="button" className="btn ghost" disabled={downloading || dirty} onClick={() => void save(api.pdfUrl(id, 'cv'), 'Lebenslauf.pdf')}>{t('applications.download.cv')}</button>
        {view.attachments.filter((x) => x.selected && !x.missing).map((x) => (
          <button key={x.id} type="button" className="btn ghost" disabled={downloading || dirty} onClick={() => void save(api.attachmentUrl(id, x.id), `${x.label || 'Anlage'}.pdf`)}>{t('applications.download.attachment', { name: x.label })}</button>
        ))}
        <button type="button" className="btn" disabled={downloading || dirty} onClick={() => void save(api.pdfUrl(id, 'bundle'), 'Bewerbung.pdf')}>{t('applications.download.bundle')}</button>
      </div>

      {a.sentEmail ? (
        <details className="sent-info">
          <summary>{t('applications.sentInfo.title')}</summary>
          <dl>
            <dt>{t('applications.sentInfo.to')}</dt><dd>{a.sentEmail.to}</dd>
            <dt>{t('applications.sentInfo.subject')}</dt><dd>{a.sentEmail.subject}</dd>
            <dt>{t('applications.sentInfo.body')}</dt><dd className="sent-info__body">{a.sentEmail.body}</dd>
            <dt>{t('applications.sentInfo.attachments')}</dt><dd>{a.sentEmail.attachments.join(', ')}</dd>
          </dl>
        </details>
      ) : null}

      <PersonalDataWarning warnings={warnings} />
      <div className="btn-row app-actions">
        {frozen ? null : a.status === 'draft'
          ? <button type="button" className="btn" disabled={locked || dirty || a.letter.pages > 1} onClick={() => void act(() => api.approveApplication(id))}>{t('applications.approve')}</button>
          : <button type="button" className="btn ghost" disabled={locked || dirty} onClick={() => void act(() => api.unapproveApplication(id))}>{t('applications.unapprove')}</button>}
        {a.status === 'approved' ? <button type="button" className="btn" disabled={!mailReady || dirty || busy || locked || sending} onClick={() => { setSentTo(null); setSending(true); }}>{t('applications.send.button')}</button> : null}
        {a.status === 'approved' ? <button type="button" className="btn ghost" disabled={busy || locked || dirty || sending} onClick={() => { setStatusOpen(false); setConfirm('submitted'); }}>{t('applications.submitted.button')}</button> : null}
        {frozen ? <button type="button" className="btn ghost" disabled={busy || error !== null} onClick={() => { setConfirm(null); setStatusOpen(true); }}>{t('applications.statusChange.button')}</button> : null}
        {a.status === 'rejected' ? <button type="button" className="btn" disabled={busy || error !== null || replying !== null} onClick={() => setReplying('rejection')}>{t('applications.reply.rejection')}</button> : null}
        {a.status === 'offer' ? <button type="button" className="btn" disabled={busy || error !== null || replying !== null} onClick={() => setReplying('offerText')}>{t('applications.reply.offer')}</button> : null}
        {frozen ? null : <button type="button" className="btn ghost" disabled={locked || dirty || busy} onClick={() => setContactOpen(true)}>{t('contact.find')}</button>}
        {frozen
          ? <button type="button" className="btn ghost" disabled={busy || error !== null} onClick={() => void copyAsDraft()}>{t('applications.copyDraft')}</button>
          : <button type="button" className="btn ghost" disabled={busy} onClick={() => { setLanguage(a.language); setConfirm('recreate'); }}>{t('applications.recreate')}</button>}
        <button type="button" className="btn ghost" disabled={jobOnThis || error !== null} onClick={() => setConfirm('delete')}>{t('applications.delete')}</button>
      </div>
      {a.status === 'approved' && mailState === 'none' ? (
        <p className="muted">{t('applications.send.needMail')} <a href="#/settings">{t('applications.send.needMailLink')}</a></p>
      ) : null}
      {a.status === 'approved' && mailState === 'noPassword' ? (
        <p className="muted">{t('applications.send.needPassword')} <a href="#/settings">{t('applications.send.needPasswordLink')}</a></p>
      ) : null}
      <HistoryBlock history={a.history} canUndo={view.canUndo} busy={busy || error !== null} onUndo={() => void act(() => api.undoStatus(id))} />
      </div>
      {statusOpen ? (
        <StatusDialog onClose={() => setStatusOpen(false)} onSave={async (body) => { const v = await api.setStatus(id, body); setView(v); setActionError(null); setStatusOpen(false); }} />
      ) : null}
      {confirm === 'submitted' ? (
        <div className="card notice" role="alertdialog" aria-label={t('applications.submitted.button')}>
          <p>{t('applications.submitted.confirm')}</p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => { setConfirm(null); void act(() => api.markSubmitted(id)); }}>{t('applications.submitted.yes')}</button>
            <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : null}
      {dirty ? <p className="muted">{t('applications.letter.saveFirst')}</p> : null}
      {sending && a.status === 'approved' ? (
        <SendDialog id={id} onStale={() => void load()} onClose={() => setSending(false)} onSent={(v, to) => { setView(v); setSending(false); setSentTo(to); setActionError(null); }} />
      ) : null}
      {reminding ? (
        <MailDraftDialog
          id={id}
          onStale={() => void load()}
          title={t('applications.followUp.title')}
          load={() => api.followUpDraft(id)}
          send={(mail) => api.sendFollowUp(id, mail)}
          onDone={(v) => { setView(v); setReminding(false); setActionError(null); }}
          onClose={() => setReminding(false)}
          afterCopy={{ label: t('applications.followUp.markReminded'), run: () => api.markFollowUp(id) }}
        />
      ) : null}
      {contactOpen && !frozen ? (
        <ContactDialog vacancyId={a.vacancyId} canAa={AA_OFFER.test(a.vacancy.url)} partnerUrl={a.vacancy.partnerUrl ?? ''}
          initial={a.vacancy.contact} save={saveContact} onClose={() => setContactOpen(false)} />
      ) : null}
      {replying === 'offerText' && a.status === 'offer' ? (
        <OfferReplyDialog view={view} onView={setView} onClose={() => setReplying(null)} onSend={() => setReplying('offerMail')} />
      ) : null}
      {(replying === 'rejection' && a.status === 'rejected') || (replying === 'offerMail' && a.status === 'offer') ? (
        <MailDraftDialog
          id={id}
          onStale={() => void load()}
          title={t(replying === 'rejection' ? 'applications.reply.rejection' : 'applications.reply.offer')}
          load={() => api.replyDraft(id)}
          send={(mail) => api.sendReply(id, mail)}
          onDone={(v) => { setView(v); setReplying(null); setActionError(null); }}
          onClose={() => setReplying(replying === 'offerMail' ? 'offerText' : null)}
        />
      ) : null}
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
      {draftExistsId ? (
        <p className="notice" role="alert">
          {t('errors.reasons.draftExists')} <a href={`#/applications/${draftExistsId}`}>{t('applications.open')}</a>
        </p>
      ) : actionError ? <ErrorBanner error={actionError} /> : null}
    </section>
  );
}
