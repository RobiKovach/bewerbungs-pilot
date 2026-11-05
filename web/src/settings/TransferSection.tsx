import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';

/** Reasons whose own sentence is the whole message (the file is too big for the import, or the data is being replaced). */
const OWN_REASONS = new Set(['backupTooLarge', 'restoreRunning', 'updateRunning']);
/** Same limits as the server (counted in characters, not UTF-16 units). */
const MIN_CHARS = 8;
const MAX_CHARS = 200;

/**
 * Settings → "Move to another PC" (spec 2026-11-04 transfer, sections 3 and 8): save all data as one file, optionally
 * protected by a password. The passwords live only in this component's state and go into the one request; they are cleared
 * after a successful save and kept after a failure so the person can try again without typing twice.
 */
export function TransferSection() {
  const { t } = useTranslation();
  const passwordId = useId();
  const repeatId = useId();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const chars = [...password].length;
  const typed = password !== '';
  // Which line explains why saving waits (none while both are empty: that is a file without a password).
  const problem: 'tooShort' | 'tooLong' | 'mismatch' | null =
    typed && chars < MIN_CHARS ? 'tooShort'
      : chars > MAX_CHARS ? 'tooLong'
        : password !== repeat && (typed || repeat !== '') ? 'mismatch'
          : null;

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.exportTransfer(typed ? password : null);
      setPassword('');
      setRepeat('');
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const ownReason = error instanceof ApiError && error.reason && OWN_REASONS.has(error.reason) ? error.reason : null;
  // The password change is a new try: the old result no longer describes the fields.
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setSaved(false); };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="muted">{t('settings.transfer.intro')}</p>
      <p>{t('settings.transfer.contents')}</p>
      <p className="muted">{t('settings.transfer.notIncluded')}</p>
      <div className="form-grid">
        <div className="field">
          <label className="field-head" htmlFor={passwordId}>{t('settings.transfer.passwordLabel')}</label>
          <input id={passwordId} type="password" autoComplete="new-password" spellCheck={false} value={password}
            disabled={busy} onChange={edit(setPassword)} />
          <p className="field-hint">{t('settings.transfer.passwordHint')}</p>
        </div>
        <div className="field">
          <label className="field-head" htmlFor={repeatId}>{t('settings.transfer.repeatLabel')}</label>
          <input id={repeatId} type="password" autoComplete="new-password" spellCheck={false} value={repeat}
            disabled={busy} onChange={edit(setRepeat)} />
        </div>
      </div>
      {problem ? <p className="notice notice-warn" role="status">{t(`settings.transfer.${problem}`)}</p> : null}
      {typed ? <p className="notice notice-warn">{t('settings.transfer.forgot')}</p> : <p className="notice">{t('settings.transfer.noPassword')}</p>}
      <div className="btn-row">
        <button type="submit" className="btn" disabled={busy || problem !== null}>
          {busy ? t('settings.transfer.saving') : t('settings.transfer.save')}
        </button>
      </div>
      {saved ? <p className="ok" role="status">{t('settings.transfer.saved')}</p> : null}
      {ownReason ? (
        <div className="error-banner" role="alert"><strong>{t(`errors.reasons.${ownReason}`)}</strong></div>
      ) : error ? <ErrorBanner error={error} /> : null}
      {/* Task 4 (import: "I already have a file") goes here, in this same card. */}
    </form>
  );
}
