import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkChosenFolder, createFolder, inOneDrive, resolveBackupFolder } from '../src/backup/folder.js';
import { SettingsStore } from '../src/data/settings.js';
import { AppError } from '../src/errors.js';
import { nullLogger } from '../src/log.js';
import { H, makeApp } from './helpers/app.js';

// Spaces + Cyrillic on purpose, like the other data tests.
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp тека копій-'));
const windows = process.platform === 'win32';

// Robert's work PC (2026-10-26): Documents is an organisation's OneDrive.
const ROBERT = {
  env: { USERPROFILE: 'C:\\Users\\dd-00-kovrob1', OneDriveCommercial: 'C:\\Users\\dd-00-kovrob1\\OneDrive - bbw Gruppe' },
  documents: 'C:\\Users\\dd-00-kovrob1\\OneDrive - bbw Gruppe\\Dokumente',
};

async function reasonOf(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; } catch (err) { if (err instanceof AppError) return err.reason; throw err; }
  return 'no error';
}

describe('inOneDrive', () => {
  it('knows Robert\'s Documents folder (from the env variable and from the folder name alone)', () => {
    expect(inOneDrive(ROBERT.documents, ROBERT.env)).toBe(true);
    expect(inOneDrive(ROBERT.documents, {})).toBe(true);
  });
  it('matches every OneDrive variable, case-insensitive, with either slash, the root itself too', () => {
    expect(inOneDrive('c:/users/me/sync/docs', { OneDrive: 'C:\\Users\\me\\Sync' })).toBe(true);
    expect(inOneDrive('C:\\Users\\me\\Sync\\', { OneDriveConsumer: 'C:\\Users\\me\\Sync' })).toBe(true);
    expect(inOneDrive('D:\\Firma\\Dokumente', { OneDriveCommercial: 'D:\\Firma' })).toBe(true);
  });
  it('is false for ordinary folders and for a folder that only starts like the OneDrive root', () => {
    expect(inOneDrive('C:\\Users\\me\\Documents', { OneDrive: 'C:\\Users\\me\\OneDrive' })).toBe(false);
    expect(inOneDrive('C:\\Users\\me\\Sync2\\x', { OneDrive: 'C:\\Users\\me\\Sync' })).toBe(false);
    expect(inOneDrive('D:\\Backups', {})).toBe(false);
  });
});

describe('resolveBackupFolder', () => {
  it('Robert\'s PC: automatic goes to the local profile folder, not OneDrive', async () => {
    const view = await resolveBackupFolder(null, { env: ROBERT.env, documents: async () => ROBERT.documents });
    expect(view).toMatchObject({
      dir: path.join('C:\\Users\\dd-00-kovrob1', 'BewerbungsPilot', 'Backups'), automatic: true, inOneDrive: false, documentsInOneDrive: true,
    });
  });
  it('Documents outside OneDrive: Documents\\BewerbungsPilot\\Backups', async () => {
    const view = await resolveBackupFolder(null, { env: { USERPROFILE: 'C:\\Users\\me' }, documents: async () => 'C:\\Users\\me\\Documents' });
    expect(view).toMatchObject({ dir: path.join('C:\\Users\\me\\Documents', 'BewerbungsPilot', 'Backups'), automatic: true, inOneDrive: false, documentsInOneDrive: false });
  });
  it('available: an existing folder, or a missing one on a drive that is there; never creates anything', async () => {
    const root = tempRoot();
    const missing = path.join(root, 'not yet', 'Backups');
    expect((await resolveBackupFolder(root, { env: {}, documents: async () => root })).available).toBe(true);
    expect((await resolveBackupFolder(missing, { env: {}, documents: async () => root })).available).toBe(true);
    expect(fs.existsSync(path.join(root, 'not yet'))).toBe(false);
    fs.writeFileSync(path.join(root, 'a file'), 'x');
    expect((await resolveBackupFolder(path.join(root, 'a file'), { env: {}, documents: async () => root })).available).toBe(false);
  });
  it.skipIf(!windows)('available is false on a drive letter that does not exist (USB stick not plugged in)', async () => {
    const free = [...'QRSTUVWXYZ'].find((l) => !fs.existsSync(`${l}:\\`));
    if (!free) return;
    const view = await resolveBackupFolder(`${free}:\\Sicherung`, { env: {}, documents: async () => tempRoot() });
    expect(view).toMatchObject({ dir: `${free}:\\Sicherung`, available: false });
  });
  it('a chosen folder wins over the automatic one; a chosen OneDrive folder is reported', async () => {
    const opts = { env: ROBERT.env, documents: async () => ROBERT.documents };
    expect(await resolveBackupFolder('D:\\Sicherung', opts)).toMatchObject({ dir: 'D:\\Sicherung', automatic: false, inOneDrive: false });
    expect(await resolveBackupFolder(`${ROBERT.documents}\\Kopien`, opts)).toMatchObject({ automatic: false, inOneDrive: true, documentsInOneDrive: true });
  });
  it('BP_BACKUP_DIR wins over everything (tests, e2e); createFolder creates it', async () => {
    const want = path.join(tempRoot(), 'my backups');
    const view = await resolveBackupFolder('D:\\Sicherung', { env: { BP_BACKUP_DIR: want }, documents: async () => ROBERT.documents });
    expect(view).toMatchObject({ dir: path.resolve(want), automatic: false });
    expect(await createFolder(view.dir)).toBe(view.dir);
    expect(fs.statSync(want).isDirectory()).toBe(true);
  });
  it('createFolder: a folder that cannot be created → BACKUP_FAILED with its own sentence', async () => {
    const parent = tempRoot();
    fs.writeFileSync(path.join(parent, 'a file'), 'x');
    expect(await reasonOf(createFolder(path.join(parent, 'a file', 'Backups')))).toBe('backupFolderUnavailable');
  });
});

describe('checkChosenFolder', () => {
  const data = () => { const d = path.join(tempRoot(), 'BewerbungsPilot'); fs.mkdirSync(d, { recursive: true }); return d; };

  it('creates a writable folder, returns it normalised and leaves no probe file', async () => {
    const want = path.join(tempRoot(), 'нові копії');
    expect(await checkChosenFolder(`  ${want}${path.sep}  `, data())).toBe(path.resolve(want));
    expect(fs.readdirSync(want)).toEqual([]);
  });
  it('refuses network shares, relative paths and folders without a drive', async () => {
    for (const p of ['\\\\server\\share\\Backups', '//server/share', 'Backups', '..\\x', '\\Backups']) {
      expect(await reasonOf(checkChosenFolder(p, data())), p).toBe('backupFolderInvalid');
    }
  });
  it('refuses the app data folder and anything inside it', async () => {
    const root = data();
    expect(await reasonOf(checkChosenFolder(root, root))).toBe('backupFolderInData');
    expect(await reasonOf(checkChosenFolder(path.join(root, 'profile', 'x'), root))).toBe('backupFolderInData');
    // A sibling whose name only starts like the data folder is fine.
    expect(await checkChosenFolder(`${root} Kopien`, root)).toBe(path.resolve(`${root} Kopien`));
  });
  it('refuses a folder that cannot be created (a file is in the way)', async () => {
    const parent = tempRoot();
    fs.writeFileSync(path.join(parent, 'a file'), 'x');
    expect(await reasonOf(checkChosenFolder(path.join(parent, 'a file', 'Backups'), data()))).toBe('backupFolderNotWritable');
  });
});

describe('settings v4 — backups.folder', () => {
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp-set4-'));
  const load = (dir: string, doc: unknown) => {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(doc));
    return new SettingsStore(path.join(dir, 'settings.json')).load();
  };
  const abs = path.resolve(os.tmpdir(), 'Sicherung');

  it('a v3 file becomes v4 with the automatic folder', () => {
    expect(load(tmpDir(), { schemaVersion: 3, updates: { check: false, dismissedVersion: null } })).toMatchObject({
      schemaVersion: 4, updates: { check: false }, backups: { folder: null },
    });
  });
  it('keeps a stored absolute folder; drops relative and network paths', () => {
    const dir = tmpDir();
    expect(load(dir, { schemaVersion: 4, backups: { folder: abs } }).backups.folder).toBe(abs);
    for (const bad of ['Backups', '\\\\server\\share', 42, '']) expect(load(dir, { schemaVersion: 4, backups: { folder: bad } }).backups.folder).toBeNull();
  });
  it('the v1 provider rule does not apply to v4', () => {
    expect(load(tmpDir(), { schemaVersion: 4, onboarding: { currentStep: null, completed: true }, llm: { timeoutSec: 180, provider: null } }).llm.provider).toBeNull();
  });
  it('setBackupFolder persists', () => {
    const dir = tmpDir();
    const s = new SettingsStore(path.join(dir, 'settings.json'));
    s.load();
    s.setBackupFolder(abs);
    expect(new SettingsStore(path.join(dir, 'settings.json')).load().backups.folder).toBe(abs);
  });
});

describe('backup folder API', { timeout: 30_000 }, () => {
  type View = { dir: string; automatic: boolean; inOneDrive: boolean; documentsInOneDrive: boolean; backups: { name: string }[] };
  const put = (ctx: Awaited<ReturnType<typeof makeApp>>, folder: unknown) =>
    ctx.app.inject({ method: 'PUT', url: '/api/backups/folder', headers: H, payload: { folder } });
  const list = async (ctx: Awaited<ReturnType<typeof makeApp>>) => (await ctx.app.inject({ method: 'GET', url: '/api/backups', headers: H })).json() as View;

  it('GET says where backups go and why (Documents in OneDrive → local folder)', async () => {
    const home = tempRoot();
    const documents = path.join(tempRoot(), 'OneDrive - Firma', 'Dokumente');
    fs.mkdirSync(documents, { recursive: true });
    const ctx = await makeApp({ documents, backupEnv: { USERPROFILE: home } });
    expect(await list(ctx)).toMatchObject({
      dir: path.join(home, 'BewerbungsPilot', 'Backups'), automatic: true, inOneDrive: false, documentsInOneDrive: true, backups: [],
    });
  });

  it('PUT saves a chosen folder, lists from it, backups go there; null goes back to automatic', async () => {
    const ctx = await makeApp();
    const chosen = path.join(tempRoot(), 'Мої копії');
    const res = await put(ctx, chosen);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ dir: chosen, automatic: false, backups: [] });
    expect(ctx.settings.get().backups.folder).toBe(chosen);

    await ctx.app.inject({ method: 'POST', url: '/api/backups', headers: H });
    expect(fs.readdirSync(chosen).filter((n) => n.endsWith('.zip'))).toHaveLength(1);
    expect((await list(ctx)).backups).toHaveLength(1);

    const back = await put(ctx, null);
    expect(back.json()).toMatchObject({ dir: ctx.backupDir, automatic: true, backups: [] });
    expect(ctx.settings.get().backups.folder).toBeNull();
  });

  it('PUT refuses a network share and the data folder, with their own reasons, and keeps the old folder', async () => {
    const ctx = await makeApp();
    const share = await put(ctx, '\\\\server\\share\\Backups');
    expect(share.statusCode).toBe(400);
    expect(share.json().error.reason).toBe('backupFolderInvalid');
    const inData = await put(ctx, path.join(ctx.dir, 'profile'));
    expect(inData.json().error.reason).toBe('backupFolderInData');
    expect(ctx.settings.get().backups.folder).toBeNull();
  });

  it('a restore keeps the backup folder of this PC (the backup\'s own settings do not move it)', async () => {
    const ctx = await makeApp();
    const made = (await ctx.app.inject({ method: 'POST', url: '/api/backups', headers: H })).json() as { name: string };
    const chosen = path.join(tempRoot(), 'chosen');
    await put(ctx, chosen);
    fs.copyFileSync(path.join(ctx.backupDir, made.name), path.join(chosen, made.name));

    const res = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', headers: H, payload: { name: made.name } });
    expect(res.statusCode).toBe(200);
    expect(ctx.settings.get().backups.folder).toBe(chosen);
    expect(JSON.parse(fs.readFileSync(path.join(ctx.dir, 'settings.json'), 'utf8')).backups.folder).toBe(chosen);
    // The "before restore" copy went to the chosen folder too.
    expect(fs.readdirSync(chosen).filter((n) => n.endsWith('.zip'))).toHaveLength(2);
  });

  it('a restore that succeeded stays a success when keeping the folder cannot be written (logged instead)', async () => {
    const warnings: string[] = [];
    const ctx = await makeApp({ logger: { ...nullLogger, warn: (event: string) => { warnings.push(event); } } });
    const made = (await ctx.app.inject({ method: 'POST', url: '/api/backups', headers: H })).json() as { name: string };
    const chosen = path.join(tempRoot(), 'chosen');
    await put(ctx, chosen);
    fs.copyFileSync(path.join(ctx.backupDir, made.name), path.join(chosen, made.name));
    vi.spyOn(ctx.settings, 'setBackupFolder').mockImplementation(() => { throw new AppError('DATA_WRITE_FAILED', 'disk full'); });

    const res = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', headers: H, payload: { name: made.name } });
    expect(res.statusCode).toBe(200);
    expect(warnings).toContain('backup_folder_keep_failed');
  });

  it('a chosen folder that is gone (USB stick unplugged): GET still answers, saving says why', async () => {
    const ctx = await makeApp();
    const stick = path.join(tempRoot(), 'stick');
    await put(ctx, stick);
    // The stick is gone: where the folder was, something else now stands (a missing drive cannot be faked portably).
    fs.rmSync(stick, { recursive: true });
    fs.writeFileSync(stick, 'not a folder');

    const res = await ctx.app.inject({ method: 'GET', url: '/api/backups', headers: H });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ dir: stick, automatic: false, available: false, backups: [] });

    const save = await ctx.app.inject({ method: 'POST', url: '/api/backups', headers: H });
    expect(save.statusCode).toBe(500);
    expect(save.json().error).toMatchObject({ code: 'BACKUP_FAILED', reason: 'backupFolderUnavailable' });

    // Choosing another folder (or automatic) still works.
    expect((await put(ctx, null)).json()).toMatchObject({ dir: ctx.backupDir, automatic: true, available: true });
  });

  it('GET does not create a missing automatic folder; the first backup does', async () => {
    const ctx = await makeApp();
    fs.rmSync(ctx.backupDir, { recursive: true });
    expect((await list(ctx))).toMatchObject({ dir: ctx.backupDir, available: true, backups: [] });
    expect(fs.existsSync(ctx.backupDir)).toBe(false);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/backups', headers: H })).statusCode).toBe(200);
    expect(fs.readdirSync(ctx.backupDir)).toHaveLength(1);
  });
});

describe.skipIf(!windows)('installer folder rules match the app', () => {
  const INSTALLER = fileURLToPath(new URL('../../installer/install.ps1', import.meta.url));
  const psString = (s: string) => `'${s.replace(/'/g, "''")}'`;

  /** Get-BpBackupDir in a PowerShell child with exactly these OneDrive/USERPROFILE variables. */
  function installerDir(env: Record<string, string>, dataDir: string, documents: string): string {
    // Case-insensitive: Windows treats ONEDRIVE and OneDrive as one variable, and a test worker's copy of the
    // environment may spell it either way — a leftover would shadow the test's own value.
    const drop = new Set(['onedrive', 'onedrivecommercial', 'onedriveconsumer', 'bp_backup_dir', 'userprofile']);
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !drop.has(k.toLowerCase())));
    return execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8; . ${psString(INSTALLER)}; Get-BpBackupDir -DataDir ${psString(dataDir)} -Documents ${psString(documents)}`,
    ], { encoding: 'utf8', windowsHide: true, timeout: 60_000, env: { ...childEnv, ...env } }).trim();
  }

  it('gives the same folder as the server for the same inputs', async () => {
    const dataDir = tempRoot();
    const cases: { env: Record<string, string>; documents: string; settings: unknown }[] = [
      { ...ROBERT, settings: null },
      { env: { USERPROFILE: 'C:\\Users\\me' }, documents: 'C:\\Users\\me\\Documents', settings: { schemaVersion: 4, backups: { folder: null } } },
      { env: { USERPROFILE: 'C:\\Users\\Ольга', OneDrive: 'C:\\Users\\Ольга\\Sync' }, documents: 'C:\\Users\\Ольга\\Sync\\Документи', settings: { schemaVersion: 3 } },
      { ...ROBERT, settings: { schemaVersion: 4, backups: { folder: 'D:\\Sicherung BP' } } },
      { ...ROBERT, settings: { schemaVersion: 4, backups: { folder: '\\\\server\\share' } } },
      { ...ROBERT, settings: '{ broken' },
    ];
    for (const c of cases) {
      const file = path.join(dataDir, 'settings.json');
      if (c.settings === null) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, typeof c.settings === 'string' ? c.settings : JSON.stringify(c.settings));
      const stored = new SettingsStore(file).load().backups.folder;
      const server = await resolveBackupFolder(stored, { env: c.env, documents: async () => c.documents });
      expect(installerDir(c.env, dataDir, c.documents), JSON.stringify(c)).toBe(server.dir);
    }
  }, 120_000);
});
