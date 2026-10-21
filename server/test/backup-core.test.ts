import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yauzl from 'yauzl';
import { createBackup } from '../src/backup/create.js';
import { extractBackup, inspectBackup, listBackups } from '../src/backup/extract.js';
import { backupDir } from '../src/backup/folder.js';
import { MAX_ENTRIES, MAX_UNPACKED_BYTES } from '../src/backup/format.js';
import { dataPaths, ensureDataDirs } from '../src/data/paths.js';
import { AppError } from '../src/errors.js';
import { metaEntry, rawZip, type RawEntry } from './helpers/zip.js';

// Spaces + Cyrillic on purpose, like the other data tests: real users have folders like C:\Users\Ольга Коваль\.
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp копія з пробілом-'));

function dataRoot(): string {
  const p = dataPaths(path.join(tempRoot(), 'BewerbungsPilot'));
  ensureDataDirs(p);
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(p.root, rel)), { recursive: true });
    fs.writeFileSync(path.join(p.root, rel), text);
  };
  put('settings.json', '{"schemaVersion":2}');
  put('profile/profile.json', '{"name":"Max"}');
  put('profile/files/photo.jpg', 'jpeg bytes');
  put('vacancies/texts/a.txt', 'vacancy');
  put('applications/x/package.json', '{"id":"x"}');
  put('mail-secret.bin', 'secret');
  put('server.json', '{}');
  put('logs/app.log', 'log');
  put('tmp/t', 'tmp');
  put('profile/profile.corrupt-1.json', 'broken');
  return p.root;
}

async function entryNames(file: string): Promise<string[]> {
  const zip = await yauzl.openPromise(file);
  const names: string[] = [];
  for await (const entry of zip.eachEntry()) names.push(entry.fileName);
  return names.sort();
}

function writeZip(entries: RawEntry[]): string {
  const file = path.join(tempRoot(), 'hostile.zip');
  fs.writeFileSync(file, rawZip(entries));
  return file;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof AppError ? err.code : `not an AppError: ${String(err)}`;
  }
}

describe('createBackup', () => {
  it('creates a zip with backup.json and only the allowed paths', async () => {
    const root = dataRoot();
    const dir = tempRoot();
    const info = await createBackup(root, { dir, kind: 'manual', appVersion: '0.9.0', now: new Date(2026, 9, 21, 8, 5) });
    expect(info.name).toMatch(/^BewerbungsPilot-backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
    expect(info.name).toBe('BewerbungsPilot-backup-2026-10-21-0805.zip');
    expect(info.kind).toBe('manual');
    expect(info.format).toBe(1);
    expect(info.appVersion).toBe('0.9.0');
    expect(info.sizeBytes).toBe(fs.statSync(info.file).size);
    expect(await entryNames(info.file)).toEqual([
      'applications/x/package.json', 'backup.json', 'profile/files/photo.jpg', 'profile/profile.json', 'settings.json', 'vacancies/texts/a.txt',
    ]);
  });

  it('never leaves a final-named file when writing fails', async () => {
    const root = dataRoot();
    const parent = tempRoot();
    const notAFolder = path.join(parent, 'a file');
    fs.writeFileSync(notAFolder, 'x');
    expect(await codeOf(createBackup(root, { dir: notAFolder, kind: 'manual', appVersion: '0.9.0' }))).toBe('BACKUP_FAILED');
    expect(fs.readdirSync(parent).filter((f) => f.endsWith('.zip') || f.endsWith('.partial'))).toEqual([]);
  });

  it('two backups in the same minute get two files', async () => {
    const root = dataRoot();
    const dir = tempRoot();
    const now = new Date(2026, 9, 21, 8, 5);
    const a = await createBackup(root, { dir, kind: 'manual', appVersion: '0.9.0', now });
    const b = await createBackup(root, { dir, kind: 'manual', appVersion: '0.9.0', now });
    expect(a.file).not.toBe(b.file);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.zip'))).toHaveLength(2);
  });
});

describe('inspectBackup', () => {
  const data: RawEntry = { name: 'profile/profile.json', data: '{}' };

  it.each<[string, RawEntry[]]>([
    ['../evil', [metaEntry(), data, { name: '../evil', data: 'x' }]],
    ['C:/evil', [metaEntry(), data, { name: 'C:/evil', data: 'x' }]],
    ['/abs', [metaEntry(), data, { name: '/abs', data: 'x' }]],
    ['profile\\..\\..\\evil', [metaEntry(), data, { name: 'profile\\..\\..\\evil', data: 'x' }]],
    ['logs/app.log (not allowed)', [metaEntry(), data, { name: 'logs/app.log', data: 'x' }]],
    ['symlink entry', [metaEntry(), data, { name: 'profile/link', data: 'C:/Windows', method: 0, unixMode: 0o120777 }]],
    ['missing backup.json', [data]],
    ['format 2', [metaEntry({ format: 2 }), data]],
    ['app other', [metaEntry({ app: 'other' }), data]],
    ['too many entries', [metaEntry(), ...Array.from({ length: MAX_ENTRIES }, (_, i) => ({ name: `profile/f${i}`, data: '' }))]],
    ['declared unpacked size over the limit', [metaEntry(), { name: 'profile/big.bin', data: 'small', declaredSize: MAX_UNPACKED_BYTES + 1 }]],
  ])('refuses a hostile archive: %s', async (_name, entries) => {
    expect(await codeOf(inspectBackup(writeZip(entries), { appVersion: '0.9.0' }))).toBe('BACKUP_INVALID');
  });

  it('refuses a file that is not a zip', async () => {
    const file = path.join(tempRoot(), 'x.zip');
    fs.writeFileSync(file, 'not a zip at all');
    expect(await codeOf(inspectBackup(file, { appVersion: '0.9.0' }))).toBe('BACKUP_INVALID');
  });

  it('refuses a newer backup, accepts an older one', async () => {
    expect(await codeOf(inspectBackup(writeZip([metaEntry({ appVersion: '9.9.9' }), data]), { appVersion: '0.9.0' }))).toBe('BACKUP_NEWER');
    const older = await inspectBackup(writeZip([metaEntry({ appVersion: '0.8.4' }), data]), { appVersion: '0.9.0' });
    expect(older.appVersion).toBe('0.8.4');
    expect(older.name).toBe('hostile.zip');
  });
});

describe('extractBackup', () => {
  it('restores the same files into staging', async () => {
    const root = dataRoot();
    const info = await createBackup(root, { dir: tempRoot(), kind: 'manual', appVersion: '0.9.0' });
    const staging = path.join(tempRoot(), 'stage');
    await extractBackup(info.file, staging, { appVersion: '0.9.0' });
    expect(fs.readFileSync(path.join(staging, 'profile', 'profile.json'), 'utf8')).toBe('{"name":"Max"}');
    expect(fs.readFileSync(path.join(staging, 'applications', 'x', 'package.json'), 'utf8')).toBe('{"id":"x"}');
    expect(fs.existsSync(path.join(staging, 'mail-secret.bin'))).toBe(false);
  });

  it('writes only inside staging and re-checks sizes', async () => {
    const parent = tempRoot();
    const staging = path.join(parent, 'stage');
    const liar = writeZip([metaEntry(), { name: 'profile/x.txt', data: 'a'.repeat(1000), declaredSize: 10 }]);
    // The central directory alone looks fine; the lie shows only while unpacking.
    await expect(inspectBackup(liar, { appVersion: '0.9.0' })).resolves.toBeTruthy();
    expect(await codeOf(extractBackup(liar, staging, { appVersion: '0.9.0' }))).toBe('BACKUP_INVALID');
    expect(fs.readdirSync(parent)).toEqual(['stage']);
  });

  it('refuses a hostile archive before writing anything', async () => {
    const parent = tempRoot();
    const staging = path.join(parent, 'stage');
    const evil = writeZip([metaEntry(), { name: 'profile/ok.txt', data: 'ok' }, { name: '../evil', data: 'x' }]);
    expect(await codeOf(extractBackup(evil, staging, { appVersion: '0.9.0' }))).toBe('BACKUP_INVALID');
    expect(fs.existsSync(path.join(parent, 'evil'))).toBe(false);
    expect(fs.existsSync(staging)).toBe(false);
  });
});

describe('listBackups', () => {
  it('returns newest first and skips non-backups', async () => {
    const root = dataRoot();
    const dir = tempRoot();
    await createBackup(root, { dir, kind: 'manual', appVersion: '0.9.0', now: new Date(2026, 9, 20, 9, 0) });
    await createBackup(root, { dir, kind: 'installer', appVersion: '0.9.0', now: new Date(2026, 9, 21, 9, 0) });
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
    fs.writeFileSync(path.join(dir, 'broken.zip'), 'not a zip');
    const skipped: string[] = [];
    const list = await listBackups(dir, { appVersion: '0.9.0', onSkip: (file) => skipped.push(path.basename(file)) });
    expect(list.map((b) => b.kind)).toEqual(['installer', 'manual']);
    expect(skipped).toEqual(['broken.zip']);
  });

  it('an absent folder is an empty list', async () => {
    expect(await listBackups(path.join(tempRoot(), 'nope'), { appVersion: '0.9.0' })).toEqual([]);
  });
});

describe('backupDir', () => {
  it('uses BP_BACKUP_DIR and creates it', async () => {
    const want = path.join(tempRoot(), 'my backups');
    expect(await backupDir({ BP_BACKUP_DIR: want })).toBe(path.resolve(want));
    expect(fs.statSync(want).isDirectory()).toBe(true);
  });
});
