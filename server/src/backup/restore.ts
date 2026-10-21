import fs from 'node:fs';
import path from 'node:path';
import type { BackupInfo, BackupMeta, MailSettings } from '@bp/shared';
import { ensureDataDirs, type DataPaths } from '../data/paths.js';
import { AppError, type ErrorReason } from '../errors.js';
import { createBackup } from './create.js';
import { extractBackup, inspectBackup } from './extract.js';
import { BACKUP_FILES, BACKUP_FOLDERS } from './format.js';

export interface RestoreDeps {
  paths: DataPaths;
  appVersion: string;
  backupDir: string;
  /** Why a restore cannot run now (search, package job, AI, a send), or null. Asked before and again right before the swap. */
  busy: () => ErrorReason | null;
  /** Re-reads every store from disk; synchronous, so nothing can start between the swap and the reload. */
  reload: () => void;
  mail: {
    /** The mailbox the saved key (password / Google key) belongs to. */
    before: MailSettings | null;
    /** The mailbox in the restored settings. */
    after: () => MailSettings | null;
    /** Revoke (best effort) and delete the saved key. */
    forget: () => Promise<void>;
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

/**
 * Replaces the person's data with a backup (spec 0.9.0, section 3.1). Order matters: refuse while busy → check the file
 * → save the current data as a `before-restore` backup → unpack into tmp/ → swap the four items in one synchronous
 * step (a failed rename puts the old ones back) → reload → keep or forget the mail key. Any refusal or failure before
 * the swap leaves the current data untouched.
 */
export async function restoreBackup(file: string, d: RestoreDeps): Promise<{ restored: BackupMeta; beforeRestore: BackupInfo }> {
  const reason = d.busy();
  if (reason) throw busyError(reason);
  const info = await inspectBackup(file, { appVersion: d.appVersion });
  const beforeRestore = await createBackup(d.paths.root, { dir: d.backupDir, kind: 'before-restore', appVersion: d.appVersion });
  const stamp = Date.now();
  const staging = path.join(d.paths.tmp, `restore-${stamp}`);
  const old = path.join(d.paths.tmp, `restore-${stamp}-old`);
  try {
    await fs.promises.mkdir(d.paths.tmp, { recursive: true }).catch((err: unknown) => { throw new AppError('BACKUP_FAILED', String(err)); });
    await extractBackup(file, staging, { appVersion: d.appVersion });
    // Something may have started while the backup was unpacked; from here to the reload nothing awaits.
    const late = d.busy();
    if (late) throw busyError(late);
    swap(d.paths.root, staging, old);
    ensureDataDirs(d.paths);
    d.reload();
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  // The data is restored; what remains is cleanup — a failure here must not report the restore as failed.
  await fs.promises.rm(old, { recursive: true, force: true }).catch(() => {});
  if (d.mail.before !== null && !sameMailbox(d.mail.before, d.mail.after())) await d.mail.forget().catch(() => {});
  const restored: BackupMeta = { format: info.format, app: info.app, appVersion: info.appVersion, createdAt: info.createdAt, kind: info.kind };
  return { restored, beforeRestore };
}

/** Moves each current item to `old` and the staged one in; on any error moves everything back and throws BACKUP_FAILED. */
function swap(root: string, staging: string, old: string): void {
  const done: { item: string; hadCurrent: boolean; movedIn: boolean }[] = [];
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
    for (const step of done.reverse()) {
      const current = path.join(root, step.item);
      try {
        if (step.movedIn) fs.rmSync(current, { recursive: true, force: true });
        if (step.hadCurrent && fs.existsSync(path.join(old, step.item))) fs.renameSync(path.join(old, step.item), current);
      } catch { /* best effort: the before-restore backup still holds this data */ }
    }
    throw new AppError('BACKUP_FAILED', `restore swap failed: ${String(err)}`);
  }
}
