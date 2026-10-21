import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { formatDay } from '../applications/format';
import { ErrorBanner } from '../components/ErrorBanner';
import type { BackupInfo, BackupKind } from '../types';

const KIND_KEY: Record<BackupKind, string> = {
  manual: 'settings.backups.kindManual',
  installer: 'settings.backups.kindInstaller',
  'before-restore': 'settings.backups.kindBeforeRestore',
};

/** The restore waits for other work (search, package, AI, sending) or another restore: say exactly what, not "changed meanwhile". */
const WAIT_REASONS = new Set(['restoreBusySearch', 'restoreBusyPackage', 'restoreBusyAi', 'restoreBusySend', 'restoreRunning']);

type Target = { kind: 'name'; name: string } | { kind: 'file'; file: File };
type Busy = null | 'saving' | 'restoring';

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/** Local calendar day of the backup (createdAt is UTC). */
const localDay = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Settings → Backups (spec 0.9.0, section 3.1): save a backup into the backup folder, see the backups there, restore one
 * (from the list or a chosen .zip) after a confirmation. `onRestored` lets the page reload what it shows.
 */
export function BackupsSection({ onRestored }: { onRestored?: () => Promise<void> | void }) {
  const { t, i18n } = useTranslation();
  const inputId = useId();
  const [list, setList] = useState<{ dir: string; backups: BackupInfo[] } | null>(null);
  const [listError, setListError] = useState<unknown>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Target | null>(null);
  const [done, setDone] = useState<{ beforeRestore: string; mailAgain: boolean } | null>(null);

  const load = useCallback(async () => {
    setListError(null);
    try { setList(await api.listBackups()); } catch (err) { setListError(err); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const size = (bytes: number) => t('settings.backups.size', {
    size: new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / (1024 * 1024)),
  });

  const save = async () => {
    setBusy('saving');
    setError(null);
    setSaved(null);
    setDone(null);
    try {
      const info = await api.createBackup();
      setSaved(info.name);
      setList((cur) => cur ? { ...cur, backups: [info, ...cur.backups.filter((b) => b.name !== info.name)] } : cur);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (target: Target) => {
    setConfirm(null);
    setBusy('restoring');
    setError(null);
    setSaved(null);
    setDone(null);
    try {
      const result = target.kind === 'name' ? await api.restoreBackup(target.name) : await api.restoreBackupUpload(target.file);
      // The restored settings may hold a mailbox without its password or Google key (backups never contain them).
      let mailAgain = false;
      try {
        const mail = await api.getMail();
        mailAgain = mail.mail !== null && !mail.passwordSaved;
      } catch { /* the note is only a hint */ }
      setDone({ beforeRestore: result.beforeRestore.name, mailAgain });
      await onRestored?.();
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const openFolder = async () => {
    setError(null);
    try { await api.openBackupFolder(); } catch (err) { setError(err); }
  };

  const disabled = busy !== null || confirm !== null;
  const waitReason = error instanceof ApiError && error.reason && WAIT_REASONS.has(error.reason) ? error.reason : null;

  return (
    <>
      <p className="muted">{t('settings.backups.intro')}</p>
      {list ? (
        <p>{t('settings.backups.folder')} <code className="backup-dir">{list.dir}</code></p>
      ) : null}
      <div className="btn-row">
        <button type="button" className="btn" disabled={disabled} onClick={() => void save()}>
          {busy === 'saving' ? t('settings.backups.saving') : t('settings.backups.save')}
        </button>
        <button type="button" className="btn ghost" disabled={disabled || !list} onClick={() => void openFolder()}>{t('settings.backups.openFolder')}</button>
        <label className="btn ghost" htmlFor={inputId} aria-disabled={disabled || undefined}>{t('settings.backups.chooseFile')}</label>
        <input id={inputId} type="file" accept=".zip,application/zip" className="visually-hidden" disabled={disabled}
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setConfirm({ kind: 'file', file }); }} />
      </div>
      {saved ? <p className="ok">{t('settings.backups.saved', { name: saved })}</p> : null}
      {busy === 'restoring' ? <p className="muted" role="status">{t('settings.backups.restoring')}</p> : null}

      {confirm ? (
        <div className="card notice" role="dialog" aria-label={t('settings.backups.confirmTitle')}>
          <h3>{t('settings.backups.confirmTitle')}</h3>
          <p><strong>{confirm.kind === 'name' ? confirm.name : confirm.file.name}</strong></p>
          <p>{t('settings.backups.confirmText')}</p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => void restore(confirm)}>{t('settings.backups.restore')}</button>
            <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : null}

      {done ? (
        <div role="status">
          <p className="ok">{t('settings.backups.restored', { name: done.beforeRestore })}</p>
          {done.mailAgain ? <p className="notice">{t('settings.backups.mailAgain')}</p> : null}
        </div>
      ) : null}
      {waitReason ? (
        <div className="error-banner" role="alert"><strong>{t(`errors.reasons.${waitReason}`)}</strong></div>
      ) : error ? <ErrorBanner error={error} /> : null}

      {listError ? <ErrorBanner error={listError} onRetry={() => void load()} /> : null}
      {list && list.backups.length === 0 ? <p className="muted">{t('settings.backups.empty')}</p> : null}
      {list && list.backups.length > 0 ? (
        <ul className="backup-list">
          {list.backups.map((b) => (
            <li key={b.name} className="backup-row">
              <div>
                <strong>{formatDay(localDay(b.createdAt))} {time(b.createdAt)}</strong>
                <span className="muted"> · {t('settings.backups.version', { version: b.appVersion })} · {size(b.sizeBytes)} · {t(KIND_KEY[b.kind])}</span>
                {b.newer ? <p className="muted">{t('settings.backups.newer')}</p> : null}
              </div>
              {b.newer ? null : (
                <button type="button" className="btn ghost" disabled={disabled} onClick={() => setConfirm({ kind: 'name', name: b.name })}>
                  {t('settings.backups.restore')}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
