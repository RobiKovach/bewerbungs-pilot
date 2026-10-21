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

describe('backup API', () => {
  it('POST /api/backups then GET lists it', async () => {
    const ctx = await makeApp();
    const made = await save(ctx);
    expect(made.kind).toBe('manual');
    const { dir, backups } = await list(ctx);
    expect(dir).toBe(ctx.backupDir);
    expect(backups.map((b) => b.name)).toEqual([made.name]);
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
    for (const name of ['..\\x.zip', 'a/b.zip', '../x.zip', 'x.txt']) {
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
    expect([txt.statusCode, txt.json().error.code]).toEqual([400, 'BAD_REQUEST']);
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
