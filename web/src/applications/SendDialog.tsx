import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type SendDraft } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { TextField } from '../profile/fields';
import type { ApplicationView } from '../types';
import { ATTACHMENTS_WARN_BYTES, mb } from './AttachmentsTab';

/** The send window: the email is prefilled from the package; what the person changes is what goes out. */
export function SendDialog({ id, onSent, onClose }: { id: string; onSent: (view: ApplicationView, to: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SendDraft | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    api.sendDraft(id).then((d) => {
      if (!alive) return;
      setDraft(d);
      setTo(d.to);
      setSubject(d.subject);
      setBody(d.body);
    }, (err: unknown) => { if (alive) setLoadError(err); });
    return () => { alive = false; };
  }, [id]);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const view = await api.sendApplication(id, { to: to.trim(), subject: subject.trim(), body });
      onSent(view, to.trim());
    } catch (err) {
      setError(err);
      setSending(false);
    }
  };

  const valid = to.trim() !== '' && subject.trim() !== '' && body.trim() !== '';
  return (
    <div className="card notice send-dialog" role="dialog" aria-label={t('applications.send.title')}>
      <h2>{t('applications.send.title')}</h2>
      {loadError ? <ErrorBanner error={loadError} /> : null}
      {!draft && !loadError ? <p className="muted">{t('common.loading')}</p> : null}
      {draft ? (
        <>
          <fieldset disabled={sending} className="plain">
            <TextField type="email" label={t('applications.send.to')} value={to} onChange={setTo} maxLength={254} />
            <TextField label={t('applications.send.subject')} value={subject} onChange={setSubject} maxLength={200} />
            <TextField multiline label={t('applications.send.body')} value={body} onChange={setBody} maxLength={5000} />
          </fieldset>
          <p><strong>{t('applications.send.attachments')}</strong></p>
          <ul className="attachment-list">
            {draft.attachments.map((x) => <li key={x.name}>{x.name} <span className="muted">({mb(x.size)})</span></li>)}
          </ul>
          <p className="muted">{t('applications.send.total', { size: mb(draft.totalSize) })}</p>
          {draft.totalSize > ATTACHMENTS_WARN_BYTES ? <p className="notice">{t('applications.attachments.tooBig')}</p> : null}
          <p className="muted">{t('applications.send.copyNote')}</p>
        </>
      ) : null}
      {error ? <ErrorBanner error={error} /> : null}
      <div className="btn-row">
        <button type="button" className="btn" disabled={!draft || !valid || sending} onClick={() => void send()}>
          {sending ? t('applications.send.sending') : error ? t('applications.send.retry') : t('applications.send.submit')}
        </button>
        <button type="button" className="btn ghost" disabled={sending} onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
