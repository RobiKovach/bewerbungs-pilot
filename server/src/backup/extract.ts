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
  const info = await readInfo(file, opts.appVersion);
  if (info.newer) throw new AppError('BACKUP_NEWER', `backup ${info.appVersion} > app ${opts.appVersion}`);
  return info;
}

/** All checks of `inspectBackup` except the version: a newer backup comes back with `newer: true`. */
async function readInfo(file: string, appVersion: string): Promise<BackupInfo> {
  const meta = await walk(file);
  const { size } = await fs.promises.stat(file);
  return { ...meta, file, name: path.basename(file), sizeBytes: size, newer: compareVersions(meta.appVersion, appVersion) > 0 };
}

/** The disk, not the backup, is the problem (full, no access, locked, path too long). */
const writeFailed = (err: unknown) => new AppError('BACKUP_FAILED', String(err));

/**
 * Unpacks a backup into `stagingDir` (which must not exist yet). Inspects first, then checks every entry again while
 * writing; yauzl stops an entry that inflates to more than its header says. On failure the staging folder may be
 * left half-written — the caller deletes it — but nothing is ever written outside it.
 */
export async function extractBackup(file: string, stagingDir: string, opts: { appVersion: string }): Promise<void> {
  await inspectBackup(file, opts);
  const root = path.resolve(stagingDir);
  await fs.promises.mkdir(root).catch((err: unknown) => { throw writeFailed(err); });
  await walk(file, async (entry, zip) => {
    const target = path.resolve(root, ...entry.fileName.split('/').filter(Boolean));
    if (!target.startsWith(root + path.sep)) throw new AppError('BACKUP_INVALID', `outside staging: ${entry.fileName}`);
    const folder = entry.fileName.endsWith('/') ? target : path.dirname(target);
    await fs.promises.mkdir(folder, { recursive: true }).catch((err: unknown) => { throw writeFailed(err); });
    if (folder === target) return;
    // `wx`: never overwrite — a second entry for the same file is an error, not a replacement.
    const input = await zip.openReadStreamPromise(entry);
    const output = fs.createWriteStream(target, { flags: 'wx' });
    // pipeline() tears down both sides when either fails, so the side that failed first decides.
    let first: 'input' | 'output' | null = null;
    input.once('error', () => { first ??= 'input'; });
    output.once('error', () => { first ??= 'output'; });
    try {
      await pipeline(input, output);
    } catch (err) {
      // Reading side (bad data, an entry larger than its header says) = damaged backup; writing side = the disk.
      throw first === 'input' ? new AppError('BACKUP_INVALID', String(err)) : writeFailed(err);
    }
  });
}

/**
 * Backups in `dir`, newest first. Files that are not valid backups are skipped; backups from a newer app version are
 * listed with `newer: true` (the person should see them, with "update the app first").
 */
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
      out.push(await readInfo(file, opts.appVersion));
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
