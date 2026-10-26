import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BackupFolderView } from '@bp/shared';
import { AppError } from '../errors.js';

let documents: Promise<string> | null = null;

export interface FolderOptions {
  env?: NodeJS.ProcessEnv;
  /** The Windows "Documents" folder; asked from Windows by default (tests pass their own). */
  documents?: () => Promise<string>;
}

/** Same check as `^[A-Za-z]:[\\/]` in installer/install.ps1: a path on a local drive letter, never `\\server\share`. */
export const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

/**
 * True when `p` is a OneDrive folder or inside one: below one of the OneDrive roots Windows sets (`OneDrive`,
 * `OneDriveCommercial`, `OneDriveConsumer`), or a path segment starting with "OneDrive"
 * ("C:\Users\me\OneDrive - Firma\Dokumente"). installer/install.ps1 `Test-BpInOneDrive` does the same.
 */
export function inOneDrive(p: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const target = norm(p);
  for (const root of [env.OneDrive, env.OneDriveCommercial, env.OneDriveConsumer]) {
    if (!root) continue;
    const r = norm(root);
    if (r && (target === r || target.startsWith(`${r}\\`))) return true;
  }
  return target.split('\\').some((segment) => segment.startsWith('onedrive'));
}

/**
 * Where backups go, in this order (installer/install.ps1 `Get-BpBackupDir` follows the same rules):
 * 1. `BP_BACKUP_DIR` (tests, e2e); 2. the folder chosen in Settings; 3. Documents\BewerbungsPilot\Backups, unless
 * Documents is synced with OneDrive — personal data must not go to a (possibly an employer's) cloud by default;
 * 4. then the local %USERPROFILE%\BewerbungsPilot\Backups.
 */
export async function resolveBackupFolder(chosen: string | null, o: FolderOptions = {}): Promise<BackupFolderView> {
  const env = o.env ?? process.env;
  const docs = await (o.documents ?? (() => (documents ??= documentsFolder(env))))();
  const documentsInOneDrive = inOneDrive(docs, env);
  let dir: string;
  if (env.BP_BACKUP_DIR) dir = path.resolve(env.BP_BACKUP_DIR);
  else if (chosen) dir = chosen;
  else if (!documentsInOneDrive) dir = path.join(docs, 'BewerbungsPilot', 'Backups');
  else dir = path.join(env.USERPROFILE ?? os.homedir(), 'BewerbungsPilot', 'Backups');
  return { dir, automatic: !env.BP_BACKUP_DIR && !chosen, inOneDrive: inOneDrive(dir, env), documentsInOneDrive, available: await usable(dir) };
}

/**
 * Whether backups can go there now, without creating anything: the folder exists, or it is missing but its drive is
 * there (it is created on the first write). False for a USB stick that is not plugged in or a drive letter that is gone,
 * or when a file stands where the folder should be.
 */
async function usable(dir: string): Promise<boolean> {
  const stat = await fs.promises.stat(dir).catch(() => null);
  if (stat) return stat.isDirectory();
  return fs.promises.stat(path.parse(path.resolve(dir)).root).then(() => true, () => false);
}

/** Creates the backup folder before writing to it (save, the "before restore" copy, opening it in Explorer). */
export async function createFolder(dir: string): Promise<string> {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (err) {
    throw new AppError('BACKUP_FAILED', String(err), 'backupFolderUnavailable');
  }
  return dir;
}

/**
 * A folder typed in Settings: an absolute path on a local drive (no network share), not inside the app's data folder
 * (a backup would then contain backups), created if missing and writable (a probe file is written and removed).
 * Returns the normalised path.
 */
export async function checkChosenFolder(raw: string, dataRoot: string): Promise<string> {
  const text = raw.trim();
  // Off Windows (never shipped there) any absolute path stands in for a drive path, so the tests run anywhere.
  if (!DRIVE_PATH.test(text) && !(process.platform !== 'win32' && path.isAbsolute(text))) {
    throw new AppError('BAD_REQUEST', 'backup folder must be an absolute local path', 'backupFolderInvalid');
  }
  const dir = path.resolve(text);
  const rel = path.relative(path.resolve(dataRoot), dir);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new AppError('BAD_REQUEST', 'backup folder inside the app data folder', 'backupFolderInData');
  }
  const probe = path.join(dir, `.bp-write-test-${crypto.randomBytes(4).toString('hex')}`);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(probe, 'ok');
    await fs.promises.rm(probe, { force: true });
  } catch (err) {
    await fs.promises.rm(probe, { force: true }).catch(() => {});
    throw new AppError('BAD_REQUEST', `backup folder not writable: ${String(err)}`, 'backupFolderNotWritable');
  }
  return dir;
}

function documentsFolder(env: NodeJS.ProcessEnv): Promise<string> {
  const fallback = path.join(env.USERPROFILE ?? os.homedir(), 'Documents');
  if (process.platform !== 'win32') return Promise.resolve(fallback);
  // UTF-8 output: the default console code page would mangle a path like C:\Users\Ольга\Документи.
  const script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments')";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      const found = err ? '' : stdout.trim();
      resolve(found && path.isAbsolute(found) && fs.existsSync(found) ? found : fallback);
    });
  });
}
