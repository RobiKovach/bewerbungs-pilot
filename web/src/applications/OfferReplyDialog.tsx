import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { ClaudeWorking } from '../profile/ClaudeWorking';
import { TextField } from '../profile/fields';
import type { ApplicationView } from '../types';

const FIELD_MAX = 50;
const BODY_MAX = 3000;

/**
 * The answer to a job offer. Step 1: what they offered and what the person wants; Claude writes the reply (a request that
 * can take a while: progress and "Cancel"). Step 2: the editable text. Typed text is never lost silently: while it has
 * unsaved changes, Copy, Send… and Close stay off.
 */
export function OfferReplyDialog({ view, onView, onClose, onSend }: {
  view: ApplicationView;
  onView: (view: ApplicationView) => void;
  onClose: () => void;
  /** Opens the mail window for this reply. */
  onSend: () => void;
}) {
  const { t } = useTranslation();
  const id = view.application.id;
  const first = view.application.offerReply;
  const [offered, setOffered] = useState(first?.offered ?? '');
  const [wanted, setWanted] = useState(first?.wanted ?? '');
  // The text as stored (null = none written yet); the shown text is `body`.
  const [saved, setSaved] = useState<string | null>(first?.body ?? null);
  const [body, setBody] = useState(first?.body ?? '');
  const [mode, setMode] = useState<'form' | 'text'>(first ? 'text' : 'form');
  const [working, setWorking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState<null | 'ok' | 'failed'>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const ask = async () => {
    const c = new AbortController();
    controller.current = c;
    setWorking(true);
    setError(null);
    setCopied(null);
    try {
      const v = await api.writeOfferReply(id, { offered: offered.trim(), wanted: wanted.trim() }, c.signal);
      const r = v.application.offerReply;
      if (r) { setSaved(r.body); setBody(r.body); }
      setMode('text');
      onView(v);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(err);
    } finally {
      if (controller.current === c) controller.current = null;
      setWorking(false);
    }
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const v = await api.saveOfferReply(id, body);
      // The server trims the text: show what is stored, otherwise the text would stay "unsaved" for good.
      const stored = v.application.offerReply?.body ?? body.trim();
      setSaved(stored);
      setBody(stored);
      onView(v);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
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

  const title = t('applications.reply.offer');
  const fieldsOk = offered.trim() !== '' && wanted.trim() !== '' && /\d/.test(wanted);
  const dirty = mode === 'text' && body !== saved;
  const empty = body.trim() === '';
  return (
    <div className="card notice send-dialog" role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {working ? <ClaudeWorking textKey="applications.offerReply.working" onCancel={() => controller.current?.abort()} /> : null}
      {mode === 'form' && !working ? (
        <>
          <TextField label={t('applications.offerReply.offered')} value={offered} onChange={setOffered} maxLength={FIELD_MAX} />
          <TextField label={t('applications.offerReply.wanted')} value={wanted} onChange={setWanted} maxLength={FIELD_MAX} hint={t('applications.offerReply.wantedHint')} />
        </>
      ) : null}
      {mode === 'text' && !working ? (
        <TextField multiline rows={14} label={t('applications.offerReply.text')} value={body} onChange={setBody} maxLength={BODY_MAX} />
      ) : null}
      {copied === 'ok' ? <p className="notice notice-ok" role="status">{t('applications.mailDraft.copied')}</p> : null}
      {copied === 'failed' ? <p className="notice" role="alert">{t('applications.mailDraft.copyFailed')}</p> : null}
      {error ? <ErrorBanner error={error} /> : null}
      {dirty ? <p className="muted">{t('applications.offerReply.saveFirst')}</p> : null}
      {working ? null : mode === 'form' ? (
        <div className="btn-row">
          <button type="button" className="btn" disabled={!fieldsOk} onClick={() => void ask()}>{t('applications.offerReply.ask')}</button>
          {saved !== null ? <button type="button" className="btn ghost" onClick={() => { setMode('text'); setError(null); }}>{t('common.back')}</button> : null}
          <button type="button" className="btn ghost" onClick={onClose}>{t('applications.offerReply.close')}</button>
        </div>
      ) : (
        <>
          {/* Two rows on purpose: working on the text, then what to do with it (no lone button wrapping). */}
          <div className="btn-row">
            <button type="button" className="btn" disabled={!dirty || empty || saving} onClick={() => void save()}>{t('applications.offerReply.save')}</button>
            <button type="button" className="btn ghost" disabled={!dirty || saving} onClick={() => { setBody(saved ?? ''); setError(null); }}>{t('applications.offerReply.discard')}</button>
            <button type="button" className="btn ghost" disabled={dirty} onClick={() => { setMode('form'); setError(null); setCopied(null); }}>{t('applications.offerReply.again')}</button>
          </div>
          <div className="btn-row">
            <button type="button" className="btn" disabled={dirty || empty} onClick={onSend}>{t('applications.offerReply.send')}</button>
            <button type="button" className="btn ghost" disabled={dirty || empty} onClick={() => void copy()}>{t('applications.offerReply.copy')}</button>
            <button type="button" className="btn ghost" disabled={dirty} onClick={onClose}>{t('applications.offerReply.close')}</button>
          </div>
        </>
      )}
    </div>
  );
}
