import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import { AppError } from '../errors.js';
import type { BackupInfo } from '@bp/shared';
import {
  BACKUP_FILES, BACKUP_FOLDERS, BACKUP_FORMAT, MAX_ENTRIES, MAX_UNPACKED_BYTES, META_FILE, SET_ASIDE,
  backupFileName, entryProblem, type BackupKind, type BackupMeta,
} from './format.js';

interface DataFile { abs: string; name: string; size: number }

/**
 * Zips the person's data (settings, profile, vacancies, applications — never the mail secret, logs or tmp) into `dir`.
 * Written as `<name>.partial` and renamed at the end, so a failure never leaves a file that looks like a backup.
 */
export async function createBackup(
  dataRoot: string,
  opts: { dir: string; kind: BackupKind; appVersion: string; now?: Date },
): Promise<BackupInfo> {
  const now = opts.now ?? new Date();
  const meta: BackupMeta = { format: BACKUP_FORMAT, app: 'bewerbungs-pilot', appVersion: opts.appVersion, createdAt: now.toISOString(), kind: opts.kind };
  let partial: string | null = null;
  try {
    await fs.promises.mkdir(opts.dir, { recursive: true });
    const files = await collect(dataRoot);
    const file = freeName(opts.dir, backupFileName(now));
    partial = `${file}.partial`;
    await writeZip(partial, meta, files);
    await fs.promises.rename(partial, file);
    partial = null;
    const { size } = await fs.promises.stat(file);
    return { ...meta, file, name: path.basename(file), sizeBytes: size };
  } catch (err) {
    if (partial) await fs.promises.rm(partial, { force: true }).catch(() => {});
    if (err instanceof AppError) throw err;
    throw new AppError('BACKUP_FAILED', String(err));
  }
}

async function collect(root: string): Promise<DataFile[]> {
  const out: DataFile[] = [];
  const add = async (abs: string, name: string) => {
    const st = await fs.promises.lstat(abs).catch(() => null);
    if (!st || st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      for (const child of (await fs.promises.readdir(abs)).sort()) await add(path.join(abs, child), `${name}/${child}`);
      return;
    }
    if (!st.isFile() || SET_ASIDE.test(name)) return;
    // A name restore would refuse must not slip into a backup silently.
    const problem = entryProblem(name);
    if (problem) throw new AppError('BACKUP_FAILED', `cannot back up ${name}: ${problem}`);
    out.push({ abs, name, size: st.size });
  };
  for (const f of BACKUP_FILES) await add(path.join(root, f), f);
  for (const d of BACKUP_FOLDERS) await add(path.join(root, d), d);
  const total = out.reduce((n, f) => n + f.size, 0);
  if (out.length + 1 > MAX_ENTRIES || total > MAX_UNPACKED_BYTES) {
    throw new AppError('BACKUP_FAILED', `data too large for a backup: ${out.length} files, ${total} bytes`);
  }
  return out;
}

/** `name.zip`, or `name-2.zip`, `name-3.zip`… when two backups are made in the same minute. */
function freeName(dir: string, name: string): string {
  const base = name.slice(0, -'.zip'.length);
  for (let n = 1; ; n++) {
    const file = path.join(dir, n === 1 ? name : `${base}-${n}.zip`);
    if (!fs.existsSync(file) && !fs.existsSync(`${file}.partial`)) return file;
  }
}

function writeZip(target: string, meta: BackupMeta, files: DataFile[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const out = fs.createWriteStream(target);
    let failed = false;
    const fail = (err: unknown) => {
      if (failed) return;
      failed = true;
      out.destroy();
      // Wait for the handle to close: Windows will not delete a file that is still open.
      out.once('close', () => reject(err));
    };
    zip.on('error', fail);
    zip.outputStream.on('error', fail);
    out.on('error', fail);
    out.on('close', () => { if (!failed) resolve(); });
    zip.outputStream.pipe(out);
    zip.addBuffer(Buffer.from(JSON.stringify(meta, null, 2), 'utf8'), META_FILE);
    for (const f of files) zip.addFile(f.abs, f.name);
    zip.end();
  });
}
