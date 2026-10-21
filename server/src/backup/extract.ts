import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { AppError } from '../errors.js';
import type { BackupInfo } from '@bp/shared';
import {
  MAX_ENTRIES, MAX_META_BYTES, MAX_UNPACKED_BYTES, META_FILE, compareVersions, entryProblem, isSymlink, parseMeta, type BackupMeta,
} from './format.js';

type OnEntry = (entry: Entry, zip: ZipFile) => Promise<void>;

/**
 * Checks a backup without writing anything: `backup.json`, every entry name, the entry count and the declared
 * unpacked size. A backup from a newer app version is refused (`BACKUP_NEWER`); older ones are fine — the stores
 * migrate old schemas when they load.
 */
export async function inspectBackup(file: string, opts: { appVersion: string }): Promise<BackupInfo> {
  const meta = await walk(file);
  if (compareVersions(meta.appVersion, opts.appVersion) > 0) {
    throw new AppError('BACKUP_NEWER', `backup ${meta.appVersion} > app ${opts.appVersion}`);
  }
  const { size } = await fs.promises.stat(file);
  return { ...meta, file, name: path.basename(file), sizeBytes: size };
}

/**
 * Unpacks a backup into `stagingDir` (which must not exist yet). Inspects first, then checks every entry again while
 * writing; yauzl stops an entry that inflates to more than its header says. On failure the staging folder may be
 * left half-written — the caller deletes it — but nothing is ever written outside it.
 */
export async function extractBackup(file: string, stagingDir: string, opts: { appVersion: string }): Promise<void> {
  await inspectBackup(file, opts);
  const root = path.resolve(stagingDir);
  await fs.promises.mkdir(root);
  await walk(file, async (entry, zip) => {
    const target = path.resolve(root, ...entry.fileName.split('/').filter(Boolean));
    if (!target.startsWith(root + path.sep)) throw new AppError('BACKUP_INVALID', `outside staging: ${entry.fileName}`);
    if (entry.fileName.endsWith('/')) {
      await fs.promises.mkdir(target, { recursive: true });
      return;
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    // `wx`: never overwrite — a second entry for the same file is an error, not a replacement.
    await pipeline(await zip.openReadStreamPromise(entry), fs.createWriteStream(target, { flags: 'wx' }));
  });
}

/** Backups in `dir`, newest first. Files that are not valid backups for this app version are skipped. */
export async function listBackups(
  dir: string,
  opts: { appVersion: string; onSkip?: (file: string, err: unknown) => void },
): Promise<BackupInfo[]> {
  let names: string[];
  try {
    names = (await fs.promises.readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && /\.zip$/i.test(d.name)).map((d) => d.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new AppError('BACKUP_FAILED', String(err));
  }
  const out: BackupInfo[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      out.push(await inspectBackup(file, opts));
    } catch (err) {
      opts.onSkip?.(file, err);
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

/** Reads every entry, applies all checks, returns `backup.json`; `onEntry` sees each data entry after its checks. */
async function walk(file: string, onEntry?: OnEntry): Promise<BackupMeta> {
  let zip: ZipFile | null = null;
  try {
    // strictFileNames: keep `\` in names as-is, so the name check below sees (and refuses) it.
    zip = await yauzl.openPromise(file, { decodeStrings: true, validateEntrySizes: true, strictFileNames: true });
    if (zip.entryCount > MAX_ENTRIES) throw new AppError('BACKUP_INVALID', `${zip.entryCount} entries`);
    const seen = new Set<string>();
    let total = 0;
    let meta: BackupMeta | null = null;
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      const problem = entryProblem(name);
      if (problem) throw new AppError('BACKUP_INVALID', `${name}: ${problem}`);
      if (isSymlink(entry.externalFileAttributes)) throw new AppError('BACKUP_INVALID', `${name}: symlink`);
      // Windows file names ignore case: `Profile/x` and `profile/x` would be the same file.
      const key = name.toLowerCase();
      if (seen.has(key)) throw new AppError('BACKUP_INVALID', `${name}: duplicate`);
      seen.add(key);
      total += entry.uncompressedSize;
      if (total > MAX_UNPACKED_BYTES) throw new AppError('BACKUP_INVALID', `unpacked size over ${MAX_UNPACKED_BYTES}`);
      if (name === META_FILE) meta = await readMeta(zip, entry);
      else if (onEntry) await onEntry(entry, zip);
    }
    if (!meta) throw new AppError('BACKUP_INVALID', 'no backup.json');
    return meta;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('BACKUP_INVALID', String(err));
  } finally {
    if (zip?.isOpen) zip.close();
  }
}

async function readMeta(zip: ZipFile, entry: Entry): Promise<BackupMeta> {
  if (entry.uncompressedSize > MAX_META_BYTES) throw new AppError('BACKUP_INVALID', 'backup.json too large');
  const chunks: Buffer[] = [];
  for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk as Buffer);
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('BACKUP_INVALID', 'backup.json is not JSON');
  }
  const meta = parseMeta(raw);
  if (!meta) throw new AppError('BACKUP_INVALID', 'backup.json: not a BewerbungsPilot backup of format 1');
  return meta;
}
