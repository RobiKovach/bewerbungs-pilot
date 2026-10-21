import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';
import { createBackup } from '../src/backup/create.js';
import { inspectBackup } from '../src/backup/extract.js';
import { BACKUP_FILES, BACKUP_FOLDERS, SET_ASIDE } from '../src/backup/format.js';
import { dataPaths, ensureDataDirs } from '../src/data/paths.js';

const INSTALLER = fileURLToPath(new URL('../../installer/install.ps1', import.meta.url));
const windows = process.platform === 'win32';

// Spaces + Cyrillic on purpose, like the other data tests: real users have folders like C:\Users\Ольга Коваль\.
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp інсталятор-'));

function dataRoot(): string {
  const p = dataPaths(path.join(tempRoot(), 'BewerbungsPilot'));
  ensureDataDirs(p);
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(p.root, rel)), { recursive: true });
    fs.writeFileSync(path.join(p.root, rel), text);
  };
  put('settings.json', '{"schemaVersion":2}');
  put('profile/profile.json', '{"name":"Max"}');
  put('profile/files/фото.jpg', 'jpeg bytes');
  put('vacancies/texts/a.txt', 'vacancy');
  put('applications/x/package.json', '{"id":"x"}');
  put('mail-secret.bin', 'secret');
  put('server.json', '{}');
  put('logs/app.log', 'log');
  put('tmp/t', 'tmp');
  put('profile/profile.corrupt-1.json', 'broken');
  return p.root;
}

/** Dot-sources the installer (which only loads its functions) and runs `script` after it. */
function ps(script: string): string {
  const quoted = INSTALLER.replace(/'/g, "''");
  return execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    `[Console]::OutputEncoding = [Text.Encoding]::UTF8; . '${quoted}'; ${script}`,
  ], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
}

const psString = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function entryNames(file: string): Promise<string[]> {
  const zip = await yauzl.openPromise(file);
  const names: string[] = [];
  for await (const entry of zip.eachEntry()) names.push(entry.fileName);
  return names.sort();
}

describe('installer backup lists match the app', () => {
  // The installer cannot import format.ts; this catches the two drifting apart.
  const text = fs.readFileSync(INSTALLER, 'utf8');
  const list = (name: string) => {
    const m = new RegExp(`\\$${name} = @\\(([^)]*)\\)`).exec(text);
    return m ? [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]) : null;
  };

  it('includes the same files and folders as format.ts', () => {
    expect(list('BackupFiles')).toEqual([...BACKUP_FILES]);
    expect(list('BackupFolders')).toEqual([...BACKUP_FOLDERS]);
  });

  it('skips the same set-aside files as format.ts', () => {
    expect(/\$BackupSetAside = '([^']*)'/.exec(text)?.[1]).toBe(SET_ASIDE.source);
  });

  it('does not run the installer when dot-sourced', () => {
    expect(text).toMatch(/^if \(\$MyInvocation\.InvocationName -ne '\.'\) \{\r?$/m);
  });
});

describe.skipIf(!windows)('installer backup (PowerShell)', () => {
  it('New-BpBackup writes a backup the app accepts, with kind installer and only the data paths', async () => {
    const root = dataRoot();
    const dir = path.join(tempRoot(), 'Backups');
    ps(`New-BpBackup -DataDir ${psString(root)} -BackupDir ${psString(dir)} -AppVersion '0.8.5' | Out-Null; ` +
      `New-BpBackup -DataDir ${psString(root)} -BackupDir ${psString(dir)} -AppVersion '0.8.5' | Out-Null`);

    const names = fs.readdirSync(dir).sort();
    // Two backups in the same minute get "-2"; nothing is left as .partial.
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/^BewerbungsPilot-backup-\d{4}-\d{2}-\d{2}-\d{4}-2\.zip$/);
    expect(names[1]).toMatch(/^BewerbungsPilot-backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);

    const file = path.join(dir, names[1]!);
    const info = await inspectBackup(file, { appVersion: '0.9.0' });
    expect(info.kind).toBe('installer');
    expect(info.appVersion).toBe('0.8.5');
    expect(info.format).toBe(1);
    expect(Math.abs(Date.parse(info.createdAt) - Date.now())).toBeLessThan(5 * 60_000);
    expect(await entryNames(file)).toEqual([
      'applications/x/package.json', 'backup.json', 'profile/files/фото.jpg', 'profile/profile.json', 'settings.json', 'vacancies/texts/a.txt',
    ]);
  }, 60_000);

  it('New-BpBackup fails loudly (the installer then asks) and leaves nothing behind', () => {
    const root = dataRoot();
    const parent = tempRoot();
    const notAFolder = path.join(parent, 'a file');
    fs.writeFileSync(notAFolder, 'x');
    const out = ps(`try { New-BpBackup -DataDir ${psString(root)} -BackupDir ${psString(notAFolder)} -AppVersion '0.8.5' | Out-Null; 'no error' } catch { 'failed' }`);
    expect(out.trim()).toBe('failed');
    expect(fs.readdirSync(parent)).toEqual(['a file']);
  }, 60_000);

  it('Remove-OldBpBackups keeps the three newest installer backups and never touches other files', async () => {
    const root = dataRoot();
    const dir = tempRoot();
    const made: string[] = [];
    for (let day = 1; day <= 5; day++) {
      made.push((await createBackup(root, { dir, kind: 'installer', appVersion: '0.9.0', now: new Date(2026, 9, day, 9, 0) })).name);
    }
    const manual = (await createBackup(root, { dir, kind: 'manual', appVersion: '0.9.0', now: new Date(2026, 8, 1, 9, 0) })).name;
    fs.writeFileSync(path.join(dir, 'not a backup.zip'), 'junk');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'mine');

    ps(`Remove-OldBpBackups -BackupDir ${psString(dir)} -Keep 3`);

    expect(fs.readdirSync(dir).sort()).toEqual([...made.slice(2), manual, 'not a backup.zip', 'notes.txt'].sort());
  }, 60_000);

  it('Get-InstalledVersion reads the installed package.json, 0.0.0 when unknown', () => {
    const app = tempRoot();
    fs.writeFileSync(path.join(app, 'package.json'), '{"version":"0.8.5"}');
    const missing = path.join(tempRoot(), 'nothing here');
    expect(ps(`Get-InstalledVersion ${psString(app)}; Get-InstalledVersion ${psString(missing)}`).trim().split(/\r?\n/)).toEqual(['0.8.5', '0.0.0']);
  }, 60_000);
});
