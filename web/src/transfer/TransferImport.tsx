import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { fileRefusal, OWN_REASONS } from '../settings/BackupsSection';
import { useOptionalSettings } from '../settings';
import { markImported } from './importNotice';

const ENCRYPTED_MAGIC = 'BPENC';

/** Whether the file starts like a password-protected transfer file. An unreadable file counts as plain: the server has the last word. */
export async function isEncryptedBlob(file: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, ENCRYPTED_MAGIC.length).arrayBuffer());
    return String.fromCharCode(...head) === ENCRYPTED_MAGIC;
  } catch {
    return false;
  }
}

interface Chosen { file: File; encrypted: boolean; hasData: boolean }

/**
 * "I already have a file" (spec 2026-11-04 transfer, section 5): opens a transfer file or a backup. One screen and one button,
 * so nobody is asked twice: the password (only for a protected file) and the replace warning (only when this PC holds data).
 * The minimum length of a password is not checked here: an older or other file may differ, the server decides. The password
 * lives only in this component's state and goes into the one request.
 */
export function TransferImport({ onDone, onBusyChange }: { onDone?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const { t } = useTranslation();
  const ctx = useOptionalSettings();
  const inputId = useId();
  const passwordId = useId();
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** A chosen file refused here before any request (not a .zip, too large). */
  const [fileReason, setFileReason] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Choosing again before the first file was looked at: only the last choice counts.
  const lastChoice = useRef(0);

  const running = (on: boolean) => { setBusy(on); onBusyChange?.(on); };

  const choose = async (file: File) => {
    const choice = ++lastChoice.current;
    setChosen(null);
    setPassword('');
    setError(null);
    setDone(false);
    const refused = fileRefusal(file);
    setFileReason(refused);
    if (refused) return;
    const [encrypted, hasData] = await Promise.all([
      isEncryptedBlob(file),
      // Not known: warn rather than replace someone's data without a word.
      api.transferStatus().then((s) => s.hasData, () => true),
    ]);
    if (choice === lastChoice.current) setChosen({ file, encrypted, hasData });
  };

  const cancel = () => {
    setChosen(null);
    setPassword('');
    setError(null);
  };

  const open = async (file: Chosen) => {
    running(true);
    setError(null);
    try {
      await api.importTransfer(file.file, file.encrypted ? password : null);
      setPassword('');
      setChosen(null);
      setDone(true);
      markImported();
      await ctx?.reload();
      onDone?.();
    } catch (err) {
      // The page could not read the first bytes, the server could: this is simply the question for the password.
      if (err instanceof ApiError && err.reason === 'transferPasswordNeeded' && !file.encrypted) setChosen({ ...file, encrypted: true });
      else setError(err);
    } finally {
      running(false);
    }
  };

  const ownReason = fileReason ?? (error instanceof ApiError && error.reason && OWN_REASONS.has(error.reason) ? error.reason : null);

  return (
    <>
      <p className="muted">{t('settings.transfer.importIntro')}</p>
      <div className="btn-row">
        <label className="btn ghost" htmlFor={inputId} aria-disabled={busy || undefined}>{t('settings.transfer.importChoose')}</label>
        <input id={inputId} type="file" accept=".zip,application/zip" className="visually-hidden" disabled={busy}
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void choose(file); }} />
      </div>
      {chosen ? (
        <form onSubmit={(e) => { e.preventDefault(); if (!busy && !(chosen.encrypted && password === '')) void open(chosen); }}>
          <p className="chosen-file"><strong>{chosen.file.name}</strong></p>
          {chosen.encrypted ? (
            <div className="field">
              <label className="field-head" htmlFor={passwordId}>{t('settings.transfer.importPasswordLabel')}</label>
              <input id={passwordId} type="password" autoComplete="current-password" spellCheck={false} value={password}
                disabled={busy} onChange={(e) => setPassword(e.target.value)} />
            </div>
          ) : null}
          {chosen.hasData ? <p className="notice notice-warn">{t('settings.transfer.importWarning')}</p> : null}
          <div className="btn-row">
            <button type="submit" className="btn" disabled={busy || (chosen.encrypted && password === '')}>
              {chosen.hasData ? t('settings.transfer.importOpenReplace') : t('settings.transfer.importOpen')}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={cancel}>{t('common.cancel')}</button>
          </div>
        </form>
      ) : null}
      {busy ? <p className="muted" role="status">{t('settings.transfer.importing')}</p> : null}
      {done ? <p className="ok" role="status">{t('settings.transfer.imported')}</p> : null}
      {ownReason ? (
        <div className="error-banner" role="alert"><strong>{t(`errors.reasons.${ownReason}`)}</strong></div>
      ) : error ? <ErrorBanner error={error} /> : null}
    </>
  );
}
