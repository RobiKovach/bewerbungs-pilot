import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { LOST_AFTER } from '../pollHealth';
import type { Language, MailSettingsView } from '../types';

interface Props {
  address: string;
  senderName: string;
  onSaved: (v: MailSettingsView) => void;
  onBack: () => void;
  /** Pause between two questions "is the person done?" (short in tests). */
  pollMs?: number;
}

type Phase = 'idle' | 'waiting' | 'saving' | 'done' | 'cancelled' | 'failed';

/** Step 2 of the Gmail path: the person signs in on Google's page; this step watches the server and saves the account. */
export function GoogleSignInStep({ address, senderName, onSaved, onBack, pollMs = 1000 }: Props) {
  const { t, i18n } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  /** The last failure came from saving (the server may still hold the sign-in): "Try again" saves again. */
  const [resave, setResave] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const save = useCallback(async () => {
    setPhase('saving');
    setError(null);
    try {
      const view = await api.googleSave({ senderName: senderName.trim(), language: i18n.language as Language });
      if (!alive.current) return;
      setPhase('done');
      onSaved(view);
    } catch (err) {
      if (!alive.current) return;
      setError(err);
      // A sign-in the server no longer holds (CONFLICT) or one without the "send" permission (MAIL_SCOPE) cannot be
      // saved again: start over instead.
      setResave(!(err instanceof ApiError && (err.code === 'CONFLICT' || err.code === 'MAIL_SCOPE')));
      setPhase('failed');
    }
  }, [senderName, i18n.language, onSaved]);

  // The polling effect always calls the latest save() without restarting its timer when the parent re-renders.
  const saveRef = useRef(save);
  saveRef.current = save;

  const start = async () => {
    setPhase('waiting');
    setError(null);
    setSignedInAs(null);
    setResave(false);
    try {
      const { url: signInUrl } = await api.googleStart(address.trim());
      if (!alive.current) return;
      setUrl(signInUrl);
      window.open(signInUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if (!alive.current) return;
      setError(err);
      setPhase('failed');
    }
  };

  // While waiting: ask the server every pollMs; stops on phase change and on unmount.
  useEffect(() => {
    if (phase !== 'waiting' || !url) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One lost answer (a short network hiccup) must not end a sign-in the person may be finishing right now.
    let fails = 0;
    const poll = async () => {
      try {
        const status = await api.googleStatus();
        if (stopped) return;
        fails = 0;
        if (status.state === 'ready') {
          setSignedInAs(status.email && status.email.toLowerCase() !== address.trim().toLowerCase() ? status.email : null);
          void saveRef.current();
          return;
        }
        if (status.state === 'cancelled') { setPhase('cancelled'); return; }
        if (status.state === 'failed') {
          setError(new ApiError(status.code ?? 'UNKNOWN', ''));
          setResave(false);
          setPhase('failed');
          return;
        }
      } catch (err) {
        if (stopped) return;
        fails += 1;
        if (fails >= LOST_AFTER) {
          setError(err);
          setResave(false);
          setPhase('failed');
          return;
        }
      }
      timer = setTimeout(() => void poll(), pollMs);
    };
    timer = setTimeout(() => void poll(), pollMs);
    return () => { stopped = true; clearTimeout(timer); };
  }, [phase, url, pollMs, address]);

  const retry = () => { void (resave ? save() : start()); };
  const busy = phase === 'waiting' || phase === 'saving';

  return (
    <>
      <h3>{t('mail.google.title')}</h3>
      <p>{t('mail.google.intro')}</p>
      <p>{t('mail.google.unverified')}</p>
      <p><strong>{t('mail.google.tick')}</strong></p>
      {phase === 'waiting' ? (
        <>
          <p className="muted" role="status">{t('mail.google.waiting')}</p>
          {url ? <p><a href={url} target="_blank" rel="noreferrer">{t('mail.google.openLink')}</a></p> : null}
        </>
      ) : null}
      {signedInAs ? <p className="notice" role="status">{t('mail.google.signedInAs', { address: signedInAs })}</p> : null}
      {phase === 'saving' ? <p className="muted" role="status">{t('mail.google.saving')}</p> : null}
      {phase === 'done' ? <p className="ok" role="status">{t('mail.google.done')}</p> : null}
      {phase === 'cancelled' ? <p className="notice" role="status">{t('mail.google.cancelled')}</p> : null}
      {phase === 'failed' && error ? <ErrorBanner error={error} /> : null}
      <div className="btn-row">
        <button type="button" className="btn ghost" disabled={phase === 'saving'} onClick={onBack}>{t('common.back')}</button>
        {phase === 'cancelled' || phase === 'failed'
          ? <button type="button" className="btn" onClick={retry}>{t('mail.google.retry')}</button>
          : <button type="button" className="btn" disabled={busy || phase === 'done'} onClick={() => void start()}>{t('mail.google.button')}</button>}
      </div>
    </>
  );
}
