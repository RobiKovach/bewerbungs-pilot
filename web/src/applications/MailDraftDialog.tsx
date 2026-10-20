import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { TextField } from '../profile/fields';
import { useReportUnsaved } from '../profile/unsaved';
import type { ApplicationView, MailDraft } from '../types';
import { isStale, useScrollIntoView } from './dialog';
import { addressOk } from './format';
import { PersonalDataWarning } from './PersonalDataWarning';
import { useTextCheck } from './useTextCheck';

/**
 * A reminder or a reply: prefilled address, subject and message that the person can change, then "Send" (needs connected
 * mail) or "Copy" (the message text only; the optional `afterCopy` button records that it was done).
 */
export function MailDraftDialog({ id, title, load, send, onDone, onClose, afterCopy, onStale }: {
  /** The package: the text is checked for personal data that is not in the profile. */
  id: string;
  title: string;
  load: () => Promise<MailDraft>;
  send: (mail: { to: string; subject: string; body: string }) => Promise<ApplicationView>;
  onDone: (view: ApplicationView) => void;
  onClose: () => void;
  /** Shown after "Copy" (reminder: "Mark as reminded"). */
  afterCopy?: { label: string; run: () => Promise<ApplicationView> };
  /** The package changed meanwhile (reminder already done, status changed): the editor loads it again. */
  onStale?: () => void;
}) {
  const { t } = useTranslation();
  const ref = useScrollIntoView<HTMLDivElement>();
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState<null | 'ok' | 'failed'>(null);
  /** Only a failed SEND turns the Send button into "Try again" (not a failed "Mark as reminded"). */
  const [sendFailed, setSendFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    load().then((d) => {
      if (!alive) return;
      setDraft(d);
      setTo(d.to);
      setSubject(d.subject);
      setBody(d.body);
    }, (err: unknown) => { if (alive) setLoadError(err); });
    return () => { alive = false; };
    // The draft is loaded once when the dialog opens.
  }, []);

  const run = async (fn: () => Promise<ApplicationView>, isSend: boolean) => {
    setBusy(true);
    setError(null);
    setSendFailed(false);
    try {
      onDone(await fn());
    } catch (err) {
      setError(err);
      setSendFailed(isSend);
      setBusy(false);
      if (isStale(err)) onStale?.();
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };

  const warnings = useTextCheck(id, subject, body);
  const badAddress = to.trim() !== '' && !addressOk(to.trim());
  // Edited but not sent yet: leaving the page asks first.
  useReportUnsaved(draft !== null && (to !== draft.to || subject !== draft.subject || body !== draft.body));
  const valid = to.trim() !== '' && !badAddress && subject.trim() !== '' && body.trim() !== '';
  const mailReady = draft?.mailReady ?? false;
  // The email went out but could not be recorded: never offer to send it again.
  const sentNotSaved = error instanceof ApiError && error.reason === 'sentNotSaved';
  // Both are fixed by signing in with Google again (MAIL_SCOPE: that time with the "send email" box ticked).
  const reauth = error instanceof ApiError && (error.code === 'MAIL_REAUTH' || error.code === 'MAIL_SCOPE');
  return (
    <div ref={ref} className="card notice send-dialog" role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {loadError ? <ErrorBanner error={loadError} /> : null}
      {!draft && !loadError ? <p className="muted">{t('common.loading')}</p> : null}
      {draft ? (
        <>
          <fieldset disabled={busy} className="plain">
            <TextField type="email" label={t('applications.send.to')} value={to} onChange={setTo} maxLength={254} error={badAddress ? t('applications.send.badAddress') : undefined} />
            <TextField label={t('applications.send.subject')} value={subject} onChange={setSubject} maxLength={200} />
            <TextField multiline rows={12} label={t('applications.send.body')} value={body} onChange={(v) => { setBody(v); setCopied(null); }} maxLength={5000} />
          </fieldset>
          {!mailReady ? <p className="muted">{t('applications.mailDraft.needMail')} <a href="#/settings">{t('applications.mailDraft.needMailLink')}</a></p> : null}
          {copied === 'ok' ? <p className="notice notice-ok" role="status">{t('applications.mailDraft.copied')}</p> : null}
          {copied === 'failed' ? <p className="notice" role="alert">{t('applications.mailDraft.copyFailed')}</p> : null}
        </>
      ) : null}
      {sentNotSaved
        ? <p className="notice" role="alert">{t('errors.reasons.sentNotSaved')}</p>
        : error ? <ErrorBanner error={error} /> : null}
      {reauth ? <p><a href="#/settings">{t('applications.mailDraft.reauthLink')}</a></p> : null}
      {draft ? <PersonalDataWarning warnings={warnings} /> : null}
      <div className="btn-row">
        {sentNotSaved ? null : (
          <button type="button" className="btn" disabled={!draft || !mailReady || !valid || busy} onClick={() => void run(() => send({ to: to.trim(), subject: subject.trim(), body }), true)}>
            {busy ? t('applications.send.sending') : sendFailed ? t('applications.send.retry') : t('applications.send.submit')}
          </button>
        )}
        {draft && !sentNotSaved ? <button type="button" className="btn ghost" disabled={busy || body.trim() === ''} onClick={() => void copy()}>{t('applications.mailDraft.copy')}</button> : null}
        {copied === 'ok' && afterCopy ? <button type="button" className="btn ghost" disabled={busy} onClick={() => void run(afterCopy.run, false)}>{afterCopy.label}</button> : null}
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
