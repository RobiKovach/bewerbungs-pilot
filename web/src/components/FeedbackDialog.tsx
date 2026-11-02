import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { PersonalDataWarning } from '../applications/PersonalDataWarning';
import { useScrollIntoView } from '../applications/dialog';
import { TextField } from '../profile/fields';
import { useReportUnsaved } from '../profile/unsaved';
import type { PersonalFinding } from '../types';
import { ErrorBanner } from './ErrorBanner';

const PAUSE_MS = 400;
const MAX_TEXT = 5000;
// Same rules as the server: one @, no spaces or control characters, a dot in the domain.
const EMAIL = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u;
const emailOk = (s: string) => s.length <= 254 && EMAIL.test(s);

/** Personal data in the unsent text; only a hint, a failed check shows nothing. */
function useFeedbackCheck(text: string, email: string): PersonalFinding[] {
  const [warnings, setWarnings] = useState<PersonalFinding[]>([]);
  useEffect(() => {
    if (text.trim() === '') {
      setWarnings([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.checkFeedbackText(text, email.trim(), controller.signal).then(
        (r) => setWarnings(r.warnings),
        () => { if (!controller.signal.aborted) setWarnings([]); },
      );
    }, PAUSE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [text, email]);
  return warnings;
}

/**
 * Message to the developer: kind, text, the person's address (prefilled from the profile). It shows exactly what goes
 * out; the personal-data hint never blocks "Send". A failed send keeps the text.
 */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useScrollIntoView<HTMLDivElement>();
  const [kind, setKind] = useState<'problem' | 'idea'>('problem');
  const [text, setText] = useState('');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    api.health().then((h) => { if (alive) setVersion(h.version); }, () => undefined);
    return () => { alive = false; };
  }, []);
  // The profile's address, unless the person has already typed one.
  useEffect(() => {
    let alive = true;
    api.getProfile().then((p) => {
      const mail = p.profile.sections.personal.data.email;
      if (alive && mail) setEmail((cur) => (cur === '' ? mail : cur));
    }, () => undefined);
    return () => { alive = false; };
  }, []);

  const warnings = useFeedbackCheck(text, email);
  useReportUnsaved(!done && text.trim() !== '');
  const mail = email.trim();
  const badEmail = mail !== '' && !emailOk(mail);
  const tooLong = Array.from(text).length > MAX_TEXT;
  const valid = text.trim() !== '' && !tooLong && mail !== '' && !badEmail;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.sendFeedback({ kind, email: mail, text });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div ref={ref} className="card notice send-dialog" role="dialog" aria-label={t('feedback.title')}>
        <p className="notice-ok" role="status">{t('feedback.thanks')}</p>
        <div className="btn-row"><button type="button" className="btn" onClick={onClose}>{t('feedback.close')}</button></div>
      </div>
    );
  }
  return (
    <div ref={ref} className="card notice send-dialog" role="dialog" aria-label={t('feedback.title')}>
      <h2>{t('feedback.title')}</h2>
      <fieldset disabled={busy} className="plain">
        <div className="field">
          <div className="field-head"><span id="fb-kind">{t('feedback.kind')}</span></div>
          <div role="radiogroup" aria-labelledby="fb-kind" className="btn-row">
            {(['problem', 'idea'] as const).map((k) => (
              <label key={k} className="check">
                <input type="radio" name="feedback-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />{' '}
                {t(`feedback.${k}`)}
              </label>
            ))}
          </div>
        </div>
        <TextField multiline rows={6} label={t('feedback.text')} value={text} onChange={setText} maxLength={MAX_TEXT} />
        <TextField
          type="email" label={t('feedback.email')} value={email} maxLength={254}
          onChange={(v) => { setEmail(v); setEmailTouched(true); }}
          error={badEmail && (emailTouched || email !== '') ? t('feedback.emailBad') : undefined}
        />
      </fieldset>
      <p className="muted">{t('feedback.sent', { version })}</p>
      {error ? <ErrorBanner error={error} /> : null}
      <PersonalDataWarning warnings={warnings} />
      <div className="btn-row">
        <button type="button" className="btn" disabled={!valid || busy} onClick={() => void send()}>
          {busy ? t('feedback.sending') : t('feedback.send')}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
