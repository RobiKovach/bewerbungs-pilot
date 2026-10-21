import fs from 'node:fs';
import path from 'node:path';
import type { BackupInfo, BackupMeta, MailSettings } from '@bp/shared';
import { ensureDataDirs, type DataPaths } from '../data/paths.js';
import { SettingsStore } from '../data/settings.js';
import { AppError, type ErrorReason } from '../errors.js';
import { createBackup } from './create.js';
import { extractBackup, inspectBackup } from './extract.js';
import { BACKUP_FILES, BACKUP_FOLDERS } from './format.js';

type Warn = (event: string, data: Record<string, unknown>) => void;

export interface RestoreDeps {
  paths: DataPaths;
  appVersion: string;
  backupDir: string;
  /** Why a restore cannot run now (search, package job, AI, a send), or null. Asked before and again right before the swap. */
  busy: () => ErrorReason | null;
  /** Re-reads every store from disk; synchronous, so nothing can start between the swap and the reload. */
  reload: () => void;
  warn: Warn;
  mail: {
    /** The mailbox the saved key (password / Google key) belongs to. */
    before: MailSettings | null;
    /** The saved key; read before the swap, only to take an old Google key back afterwards. */
    loadKey: () => Promise<string | null>;
    /** Deletes the saved key; synchronous, so it happens in the same step as the swap. */
    removeKey: () => void;
    /** Takes an old Google key back at Google (best effort, bounded). Not awaited by the restore. */
    revoke: (key: string) => Promise<void>;
  };
}

/** What a backup replaces: the same paths it may contain. */
const ITEMS = [...BACKUP_FILES, ...BACKUP_FOLDERS];

function busyError(reason: ErrorReason): AppError {
  return new AppError('CONFLICT', `cannot restore now: ${reason}`, reason);
}

/** Same mailbox = same kind and address: its saved key still fits, keep it. */
function sameMailbox(a: MailSettings | null, b: MailSettings | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.address.toLowerCase() === b.address.toLowerCase();
}

/** The mailbox in the unpacked settings.json, read exactly as the reload will read it. */
function stagedMailbox(staging: string, warn: Warn): MailSettings | null {
  return new SettingsStore(path.join(staging, 'settings.json'), warn).load().mail;
}

/**
 * Replaces the person's data with a backup (spec 0.9.0, section 3.1). Order matters: refuse while busy → check the file
 * → save the current data as a `before-restore` backup → unpack into tmp/ → swap the four items and, when the restored
 * settings name another mailbox, delete the saved key — one synchronous step (a failed rename or delete puts the old
 * data back) → reload → take an old Google key back in the background. Any refusal or failure before the swap leaves
 * the current data untouched; settings and the saved key never belong to different mailboxes.
 */
export async function restoreBackup(file: string, d: RestoreDeps): Promise<{ restored: BackupMeta; beforeRestore: BackupInfo }> {
  const reason = d.busy();
  if (reason) throw busyError(reason);
  const info = await inspectBackup(file, { appVersion: d.appVersion });
  const beforeRestore = await createBackup(d.paths.root, { dir: d.backupDir, kind: 'before-restore', appVersion: d.appVersion });
  const stamp = Date.now();
  const staging = path.join(d.paths.tmp, `restore-${stamp}`);
  const old = path.join(d.paths.tmp, `restore-${stamp}-old`);
  let oldGoogleKey: string | null = null;
  try {
    await fs.promises.mkdir(d.paths.tmp, { recursive: true }).catch((err: unknown) => { throw new AppError('BACKUP_FAILED', String(err)); });
    await extractBackup(file, staging, { appVersion: d.appVersion });
    const forgetKey = d.mail.before !== null && !sameMailbox(d.mail.before, stagedMailbox(staging, d.warn));
    if (forgetKey && d.mail.before?.kind === 'google') oldGoogleKey = await d.mail.loadKey();
    // Something may have started while the backup was unpacked; from here to the reload nothing awaits.
    const late = d.busy();
    if (late) throw busyError(late);
    const undo = swap(d.paths.root, staging, old, d.warn);
    if (forgetKey) {
      try {
        d.mail.removeKey();
      } catch (err) {
        d.warn('restore_key_remove_failed', { message: String(err) });
        undo();
        throw new AppError('BACKUP_FAILED', `could not delete the saved mail key: ${String(err)}`);
      }
    }
    ensureDataDirs(d.paths);
    d.reload();
  } catch (err) {
    // After a rollback `old` is empty; if it is not, a rollback step failed and it holds data — leave it for support.
    await fs.promises.rmdir(old).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') d.warn('restore_cleanup_failed', { what: 'old', code: e.code });
    });
    throw err;
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true })
      .catch((err: unknown) => d.warn('restore_cleanup_failed', { what: 'staging', message: String(err) }));
  }
  // The data is restored; what remains is cleanup — a failure here must not report the restore as failed.
  await fs.promises.rm(old, { recursive: true, force: true })
    .catch((err: unknown) => d.warn('restore_cleanup_failed', { what: 'old', message: String(err) }));
  if (oldGoogleKey !== null) {
    void d.mail.revoke(oldGoogleKey).catch((err: unknown) => d.warn('restore_revoke_failed', { message: String(err) }));
  }
  const restored: BackupMeta = { format: info.format, app: info.app, appVersion: info.appVersion, createdAt: info.createdAt, kind: info.kind };
  return { restored, beforeRestore };
}

/**
 * Moves each current item to `old` and the staged one in; on any error moves everything back and throws BACKUP_FAILED.
 * Returns the same "move everything back" for a failure right after the swap.
 */
function swap(root: string, staging: string, old: string, warn: Warn): () => void {
  const done: { item: string; hadCurrent: boolean; movedIn: boolean }[] = [];
  const undo = () => {
    for (const step of [...done].reverse()) {
      const current = path.join(root, step.item);
      try {
        if (step.movedIn) fs.rmSync(current, { recursive: true, force: true });
        if (step.hadCurrent && fs.existsSync(path.join(old, step.item))) fs.renameSync(path.join(old, step.item), current);
      } catch (err) {
        // The before-restore backup still holds this data.
        warn('restore_rollback_failed', { item: step.item, message: String(err) });
      }
    }
  };
  try {
    fs.mkdirSync(old, { recursive: true });
    for (const item of ITEMS) {
      const current = path.join(root, item);
      const staged = path.join(staging, item);
      const step = { item, hadCurrent: fs.existsSync(current), movedIn: false };
      done.push(step);
      if (step.hadCurrent) fs.renameSync(current, path.join(old, item));
      if (fs.existsSync(staged)) {
        fs.renameSync(staged, current);
        step.movedIn = true;
      }
    }
  } catch (err) {
    undo();
    throw new AppError('BACKUP_FAILED', `restore swap failed: ${String(err)}`);
  }
  return undo;
}
