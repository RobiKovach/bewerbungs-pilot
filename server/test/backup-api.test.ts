import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { MailSettings } from '@bp/shared';
import { FakeProvider } from '../src/llm/fake.js';
import { pkg } from './helpers/applications.js';
import { H, makeApp } from './helpers/app.js';
import { multipartBody } from './helpers/files.js';
import { vacancy } from './helpers/vacancies.js';
import { metaEntry, rawZip } from './helpers/zip.js';

type Ctx = Awaited<ReturnType<typeof makeApp>>;

const GOOGLE_A: MailSettings = { kind: 'google', address: 'a@x.de', senderName: 'Max', provider: 'gmail' };
const SMTP_B: MailSettings = { kind: 'smtp', address: 'b@y.de', senderName: 'Max', host: 'smtp.y.de', port: 465, security: 'ssl', user: 'b@y.de', provider: 'other' };

const setName = (ctx: Ctx, fullName: string) =>
  ctx.app.inject({ method: 'PUT', url: '/api/profile/sections/personal', headers: H, payload: { data: { ...ctx.profileStore.get().sections.personal.data, fullName } } });
const save = async (ctx: Ctx) => {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/backups', headers: H });
  expect(res.statusCode).toBe(200);
  return res.json() as { name: string; kind: string };
};
const restore = (ctx: Ctx, name: string) => ctx.app.inject({ method: 'POST', url: '/api/backups/restore', headers: H, payload: { name } });
const list = async (ctx: Ctx) => (await ctx.app.inject({ method: 'GET', url: '/api/backups', headers: H })).json() as { dir: string; backups: { name: string; kind: string }[] };

/** Every file a backup may replace, with its bytes: "untouched" means this map is equal before and after. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (abs: string, rel: string) => {
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) { for (const c of fs.readdirSync(abs)) walk(path.join(abs, c), `${rel}/${c}`); return; }
    out[rel] = fs.readFileSync(abs).toString('base64');
  };
  for (const item of ['settings.json', 'profile', 'vacancies', 'applications']) walk(path.join(root, item), item);
  return out;
}

const stagingLeft = (root: string) => fs.existsSync(path.join(root, 'tmp')) ? fs.readdirSync(path.join(root, 'tmp')).filter((n) => n.startsWith('restore-')) : [];

// Each test zips and unzips real data folders: ~0.2 s alone, but over 5 s when the full suite runs the
// Edge and PowerShell tests alongside on the same cores.
describe('backup API', { timeout: 30_000 }, () => {
  it('POST /api/backups then GET lists it', async () => {
    const ctx = await makeApp();
    const made = await save(ctx);
    expect(made.kind).toBe('manual');
    const { dir, backups } = await list(ctx);
    expect(dir).toBe(ctx.backupDir);
    expect(backups.map((b) => b.name)).toEqual([made.name]);
  });

  it('restores any name the list shows: spaces, "(1)", " - Kopie", Cyrillic, upper-case .ZIP', async () => {
    const ctx = await makeApp();
    await setName(ctx, 'Max Mustermann');
    const made = await save(ctx);
    const names = ['Моя копія - Kopie (1).zip', 'backup 2026.ZIP'];
    for (const name of names) fs.copyFileSync(path.join(ctx.backupDir, made.name), path.join(ctx.backupDir, name));
    const listed = (await list(ctx)).backups.map((b) => b.name);
    for (const name of names) {
      expect(listed).toContain(name);
      const res = await restore(ctx, name);
      expect([name, res.statusCode]).toEqual([name, 200]);
    }
  });

  it('restore replaces data and keeps a before-restore copy', async () => {
    const ctx = await makeApp();
    await setName(ctx, 'Max Mustermann');
    ctx.vacancyStore.add(vacancy({ id: 'v1' }), 'Text eins');
    ctx.applicationStore.save(pkg({ id: 'app1' }), {});
    const made = await save(ctx);

    await setName(ctx, 'Erika Musterfrau');
    ctx.vacancyStore.add(vacancy({ id: 'v2' }), 'Text zwei');
    ctx.applicationStore.save(pkg({ id: 'app2' }), {});

    const res = await restore(ctx, made.name);
    expect(res.statusCode).toBe(200);
    expect(res.json().restored.kind).toBe('manual');
    expect(res.json().beforeRestore.kind).toBe('before-restore');

    const profile = (await ctx.app.inject({ method: 'GET', url: '/api/profile', headers: H })).json();
    expect(profile.profile.sections.personal.data.fullName).toBe('Max Mustermann');
    const vacancies = (await ctx.app.inject({ method: 'GET', url: '/api/vacancies', headers: H })).json();
    expect(JSON.stringify(vacancies)).toContain('v1');
    expect(JSON.stringify(vacancies)).not.toContain('v2');
    const apps = (await ctx.app.inject({ method: 'GET', url: '/api/applications', headers: H })).json();
    expect(JSON.stringify(apps)).toContain('app1');
    expect(JSON.stringify(apps)).not.toContain('app2');

    expect((await list(ctx)).backups.map((b) => b.kind).sort()).toEqual(['before-restore', 'manual']);
    expect(stagingLeft(ctx.dir)).toEqual([]);
  });

  it('restore refuses while busy and leaves the data alone', async () => {
    const cases: [string, (ctx: Ctx) => () => void][] = [
      ['restoreBusySearch', (ctx) => { const s = vi.spyOn(ctx.searchJob, 'state').mockReturnValue({ ...ctx.searchJob.state(), state: 'running' }); return () => s.mockRestore(); }],
      ['restoreBusyPackage', (ctx) => { const s = vi.spyOn(ctx.applicationJob, 'state').mockReturnValue({ ...ctx.applicationJob.state(), state: 'running' }); return () => s.mockRestore(); }],
      ['restoreBusySend', (ctx) => ctx.activity.begin('send')],
    ];
    for (const [reason, makeBusy] of cases) {
      const ctx = await makeApp();
      await setName(ctx, 'Max Mustermann');
      const made = await save(ctx);
      await setName(ctx, 'Erika Musterfrau');
      const before = snapshot(ctx.dir);
      const release = makeBusy(ctx);
      const res = await restore(ctx, made.name);
      expect([reason, res.statusCode, res.json().error.code, res.json().error.reason]).toEqual([reason, 409, 'CONFLICT', reason]);
      expect(snapshot(ctx.dir)).toEqual(before);
      expect((await list(ctx)).backups.map((b) => b.kind)).toEqual(['manual']);
      release();
    }
  });

  it('restore refuses while the AI is working', async () => {
    let finish: (v: unknown) => void = () => {};
    const provider = new FakeProvider({ ok: true }, () => new Promise((r) => { finish = r; }));
    const ctx = await makeApp({ provider });
    const made = await save(ctx);
    const running = ctx.app.inject({ method: 'POST', url: '/api/llm/test', headers: H, payload: { language: 'en' } });
    await vi.waitFor(() => expect(provider.calls.length).toBe(1));
    const res = await restore(ctx, made.name);
    expect([res.statusCode, res.json().error.reason]).toEqual([409, 'restoreBusyAi']);
    finish({ greeting: 'hi' });
    await running;
  });

  it('failed extraction leaves data untouched', async () => {
    const ctx = await makeApp();
    await setName(ctx, 'Max Mustermann');
    ctx.vacancyStore.add(vacancy({ id: 'v1' }), 'Text eins');
    // Header says 10 bytes, the entry inflates to 1000: only found while unpacking, after the file passed inspection.
    fs.writeFileSync(path.join(ctx.backupDir, 'liar.zip'), rawZip([
      metaEntry({ appVersion: '0.1.0' }),
      { name: 'settings.json', data: '{}' },
      { name: 'profile/profile.json', data: 'a'.repeat(1000), declaredSize: 10 },
    ]));
    const before = snapshot(ctx.dir);
    const res = await restore(ctx, 'liar.zip');
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'BACKUP_INVALID']);
    expect(snapshot(ctx.dir)).toEqual(before);
    expect(stagingLeft(ctx.dir)).toEqual([]);
  });

  it('refuses a backup from a newer app version without touching anything', async () => {
    const ctx = await makeApp();
    await setName(ctx, 'Max Mustermann');
    fs.writeFileSync(path.join(ctx.backupDir, 'newer.zip'), rawZip([metaEntry({ appVersion: '9.9.9' }), { name: 'settings.json', data: '{}' }]));
    const before = snapshot(ctx.dir);
    const res = await restore(ctx, 'newer.zip');
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'BACKUP_NEWER']);
    expect(snapshot(ctx.dir)).toEqual(before);
    expect((await list(ctx)).backups.map((b) => b.name)).toEqual(['newer.zip']);
  });

  it('restore name cannot escape the folder', async () => {
    const ctx = await makeApp();
    for (const name of ['..\\x.zip', 'a/b.zip', '../x.zip', 'x.txt', 'C:x.zip', '..', 'a\u0000.zip']) {
      const res = await restore(ctx, name);
      expect([name, res.statusCode]).toEqual([name, 400]);
    }
    expect((await restore(ctx, 'missing.zip')).statusCode).toBe(404);
  });

  it('mail secret: same mailbox kept, different mailbox forgotten', async () => {
    const ctx = await makeApp();
    ctx.settings.setMail(GOOGLE_A);
    await ctx.secrets.save('google-key');
    const sameMailbox = await save(ctx);
    ctx.settings.setMail(SMTP_B);
    const otherMailbox = await save(ctx);

    ctx.settings.setMail(GOOGLE_A);
    expect((await restore(ctx, sameMailbox.name)).statusCode).toBe(200);
    expect(await ctx.secrets.load()).toBe('google-key');
    expect(ctx.googleAuth.revoked).toEqual([]);

    expect((await restore(ctx, otherMailbox.name)).statusCode).toBe(200);
    expect(ctx.settings.get().mail).toEqual(SMTP_B);
    expect(await ctx.secrets.load()).toBeNull();
    expect(ctx.googleAuth.revoked).toEqual(['google-key']);
  });

  it('while a restore runs, sending, search, package jobs and mailbox changes are refused', async () => {
    const ctx = await makeApp();
    const id = pkg().id;
    const vacancyId = vacancy().id;
    const made = await save(ctx);
    const mail = { to: 'hr@firma.de', subject: 'Bewerbung', body: 'Hallo' };
    const end = ctx.activity.begin('restore');
    const calls: [string, string, unknown?][] = [
      ['POST', `/api/applications/${id}/send`, mail],
      ['POST', `/api/applications/${id}/follow-up/send`, mail],
      ['POST', `/api/applications/${id}/reply/send`, mail],
      ['POST', '/api/vacancies/search'],
      ['POST', '/api/applications', { vacancyId, language: 'de' }],
      ['POST', `/api/applications/${id}/revise`, { instruction: 'kürzer' }],
      ['POST', `/api/applications/${id}/refresh-cv`, { keepProfil: true }],
      ['POST', `/api/applications/${id}/recreate`, { language: 'de' }],
      ['PUT', '/api/mail/settings', { address: 'b@y.de', senderName: 'Max', host: 'smtp.y.de', port: 465, security: 'ssl', user: 'b@y.de', password: 'pw', language: 'de' }],
      ['DELETE', '/api/mail/settings'],
      ['POST', '/api/mail/google/save', { senderName: 'Max', language: 'de' }],
      ['POST', '/api/backups/restore', { name: made.name }],
      ['PUT', '/api/backups/folder', { folder: null }],
    ];
    for (const [method, url, payload] of calls) {
      const res = await ctx.app.inject({ method: method as 'POST', url, headers: H, ...(payload ? { payload: payload as object } : {}) });
      expect([url, res.statusCode, res.json().error?.reason]).toEqual([url, 409, 'restoreRunning']);
    }
    expect(ctx.mailer.sent).toEqual([]);
    end();
    // Afterwards the guard is gone (the search may still refuse for its own reasons, e.g. an empty profile).
    expect((await ctx.app.inject({ method: 'POST', url: '/api/vacancies/search', headers: H })).json().error?.reason).not.toBe('restoreRunning');
  });

  it('a different mailbox: the saved key is gone when the restore answers, the revoke runs in the background', async () => {
    const ctx = await makeApp();
    ctx.settings.setMail(SMTP_B);
    const smtpBackup = await save(ctx);
    ctx.settings.setMail(GOOGLE_A);
    await ctx.secrets.save('google-key');
    const revoke = vi.spyOn(ctx.googleAuth, 'revoke').mockReturnValue(new Promise(() => {}));
    const res = await restore(ctx, smtpBackup.name);
    expect(res.statusCode).toBe(200);
    expect(ctx.settings.get().mail).toEqual(SMTP_B);
    expect(await ctx.secrets.load()).toBeNull();
    expect(revoke).toHaveBeenCalledWith('google-key');
  });

  it('a rename failing in the middle of the swap puts everything back', async () => {
    const ctx = await makeApp();
    await setName(ctx, 'Max Mustermann');
    ctx.settings.setMail(SMTP_B);
    const made = await save(ctx);
    await setName(ctx, 'Erika Musterfrau');
    ctx.settings.setMail(GOOGLE_A);
    await ctx.secrets.save('google-key');
    ctx.vacancyStore.add(vacancy({ id: 'v2' }), 'Text zwei');
    const before = snapshot(ctx.dir);
    // settings.json is swapped first; moving the current profile folder away then fails (a CV PDF open in a viewer).
    const realRename = fs.renameSync;
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (path.resolve(String(from)) === path.join(ctx.dir, 'profile')) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      realRename(from, to);
    });
    try {
      const res = await restore(ctx, made.name);
      expect([res.statusCode, res.json().error.code]).toEqual([500, 'BACKUP_FAILED']);
    } finally {
      rename.mockRestore();
    }
    expect(snapshot(ctx.dir)).toEqual(before);
    expect(stagingLeft(ctx.dir)).toEqual([]);
    expect(await ctx.secrets.load()).toBe('google-key');
    expect(ctx.googleAuth.revoked).toEqual([]);
    expect((await list(ctx)).backups.map((b) => b.kind).sort()).toEqual(['before-restore', 'manual']);
    expect(ctx.profileStore.get().sections.personal.data.fullName).toBe('Erika Musterfrau');
  });

  it('restores an uploaded .zip and refuses other files', async () => {
    const ctx = await makeApp();
    await setName(ctx, 'Max Mustermann');
    const made = await save(ctx);
    await setName(ctx, 'Erika Musterfrau');
    const bytes = fs.readFileSync(path.join(ctx.backupDir, made.name));
    const res = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore-upload', ...multipartBody('meine Kopie.zip', bytes) });
    expect(res.statusCode).toBe(200);
    expect(ctx.profileStore.get().sections.personal.data.fullName).toBe('Max Mustermann');
    expect(fs.readdirSync(path.join(ctx.dir, 'tmp')).filter((n) => n.startsWith('upload-'))).toEqual([]);

    const txt = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore-upload', ...multipartBody('notes.txt', Buffer.from('hi')) });
    expect([txt.statusCode, txt.json().error.code, txt.json().error.reason]).toEqual([400, 'BAD_REQUEST', 'backupNotZip']);
  });

  it('a too large upload says "backup", not the CV/photo limits', async () => {
    const ctx = await makeApp({ maxBackupUploadBytes: 1024 });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore-upload', ...multipartBody('big.zip', Buffer.alloc(4096)) });
    expect([res.statusCode, res.json().error.code, res.json().error.reason]).toEqual([413, 'FILE_TOO_LARGE', 'backupTooLarge']);
  });

  it('a backup deleted from the folder meanwhile has its own reason', async () => {
    const ctx = await makeApp();
    const res = await restore(ctx, 'BewerbungsPilot-backup-2026-01-01-0000.zip');
    expect([res.statusCode, res.json().error.code, res.json().error.reason]).toEqual([404, 'NOT_FOUND', 'backupGone']);
  });

  it('open-folder shows the backup folder', async () => {
    const ctx = await makeApp();
    const res = await ctx.app.inject({ method: 'POST', url: '/api/backups/open-folder', headers: H });
    expect(res.statusCode).toBe(200);
    expect(ctx.openedFolders).toEqual([ctx.backupDir]);
  });

  it('without the launch key every backup route is 401', async () => {
    const { app } = await makeApp({ autoKey: false });
    const C = { 'x-bp-client': '1' };
    for (const [method, url] of [['GET', '/api/backups'], ['POST', '/api/backups'], ['POST', '/api/backups/restore'], ['POST', '/api/backups/restore-upload'], ['POST', '/api/backups/open-folder']] as const) {
      const res = await app.inject({ method, url, headers: C });
      expect([url, res.statusCode, res.json().error.code]).toEqual([url, 401, 'NO_SESSION']);
    }
  });
});
