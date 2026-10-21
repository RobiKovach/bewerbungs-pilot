import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../errors.js';

let documents: Promise<string> | null = null;

/**
 * Where backups go: `BP_BACKUP_DIR`, or the Windows "Documents" folder + `BewerbungsPilot\Backups` (created).
 * "Documents" is asked from Windows, not guessed: for many people it lives in OneDrive.
 */
export async function backupDir(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const dir = env.BP_BACKUP_DIR
    ? path.resolve(env.BP_BACKUP_DIR)
    : path.join(await (documents ??= documentsFolder(env)), 'BewerbungsPilot', 'Backups');
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (err) {
    throw new AppError('BACKUP_FAILED', String(err));
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
