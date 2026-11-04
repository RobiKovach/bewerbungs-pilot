import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../src/errors.js';
import { nullLogger } from '../src/log.js';
import { cleanOldUpdateFolders, installerEnv, readUpdateOutcome, UpdateOutcome } from '../src/updates/apply.js';
import type { UpdateStep } from '../src/updates/updater.js';
import { pkg } from './helpers/applications.js';
import { H, makeApp } from './helpers/app.js';
import { vacancy } from './helpers/vacancies.js';

const SHA = 'a'.repeat(64);
const NEWER = { version: '9.9.9', url: 'https://github.com/RobiKovach/bewerbungs-pilot/releases/tag/v9.9.9', notes: {}, sha256: SHA };

type Ctx = Awaited<ReturnType<typeof makeApp>>;

/** An updater whose end the test drives by hand. */
function fakeUpdater() {
  let finish!: (r: { releaseRoot: string } | Error) => void;
  return {
    finish: (r: { releaseRoot: string } | Error) => finish(r),
    prepare: (onStep: (s: UpdateStep) => void) => new Promise<{ releaseRoot: string }>((resolve, reject) => {
      onStep('downloading');
      finish = (r) => (r instanceof Error ? reject(r) : resolve(r));
    }),
  };
}

/** What the installer does first thing: reports `running`. */
function writeRunning(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ state: 'running', step: 'stopping', from: '0.10.1', to: '9.9.9', at: new Date().toISOString() }));
}

function setup(over: { update?: typeof NEWER | null; outcome?: UpdateOutcome } = {}) {
  const updater = fakeUpdater();
  const spawned: { file: string; args: string[]; opts: unknown }[] = [];
  const killed = { n: 0 };
  const statusFile = path.join(os.tmpdir(), 'bp-status-x', 'update-status.json');
  return {
    updater, spawned, statusFile, killed,
    make: () => makeApp({
      update: over.update === undefined ? NEWER : over.update,
      updateApply: { updater, statusFile, outcome: over.outcome ?? new UpdateOutcome({}), spawn: async (file, args, opts) => { spawned.push({ file, args, opts }); writeRunning(statusFile); return { kill: () => { killed.n++; } }; }, startWaitMs: 400 },
    }),
  };
}
const apply = (ctx: Ctx) => ctx.app.inject({ method: 'POST', url: '/api/updates/apply', headers: H });
const progress = async (ctx: Ctx) => (await ctx.app.inject({ method: 'GET', url: '/api/updates/progress', headers: H })).json();
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('POST /api/updates/apply', { timeout: 30_000 }, () => {
  it('starts: 202, progress follows the steps, installer spawned with the exact arguments, then shutdown', async () => {
    const s = setup();
    const ctx = await s.make();
    expect((await progress(ctx)).state).toBe('idle');
    const res = await apply(ctx);
    expect(res.statusCode).toBe(202);
    expect((await progress(ctx)).state).toBe('downloading');
    expect(ctx.activity.active()).toContain('update');
    expect(ctx.shutdownCalls()).toBe(0);
    s.updater.finish({ releaseRoot: 'C:\\x\\update-1\\release' });
    await tick();
    expect(s.spawned).toHaveLength(1);
    expect(s.spawned[0]).toEqual({
      file: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join('C:\\x\\update-1\\release', 'installer', 'install.ps1'),
        '-Unattended', '-StatusFile', s.statusFile, '-WaitPid', String(process.pid)],
      opts: { detached: true, stdio: 'ignore', windowsHide: true, cwd: 'C:\\x\\update-1', env: expect.any(Object) },
    });
    expect(Object.keys((s.spawned[0].opts as { env: object }).env).filter((k) => k.toUpperCase().startsWith('BP_'))).toEqual([]);
    expect(ctx.shutdownCalls()).toBe(1);
    expect((await progress(ctx)).state).toBe('installing');
  });

  it('a second apply while one runs gives 409 updateRunning', async () => {
    const s = setup();
    const ctx = await s.make();
    await apply(ctx);
    const again = await apply(ctx);
    expect([again.statusCode, again.json().error.reason]).toEqual([409, 'updateRunning']);
  });

  it('while other work runs gives 409 busy naming it; nothing starts', async () => {
    for (const what of ['send', 'restore', 'browser']) {
      const s = setup();
      const ctx = await s.make();
      const end = ctx.activity.begin(what);
      const res = await apply(ctx);
      expect([res.statusCode, res.json().error.reason, res.json().error.params]).toEqual([409, 'busy', { what }]);
      expect(ctx.activity.active()).not.toContain('update');
      expect((await progress(ctx)).state).toBe('idle');
      end();
      expect((await apply(ctx)).statusCode).toBe(202);
    }
  });

  it('an interview preparation at work counts as the AI helper working', async () => {
    const ctx = await setup().make();
    const end = ctx.activity.begin('interview');
    const res = await apply(ctx);
    expect([res.statusCode, res.json().error.reason, res.json().error.params]).toEqual([409, 'busy', { what: 'ai' }]);
    end();
    expect((await apply(ctx)).statusCode).toBe(202);
  });

  it('no installable update (nothing newer, no checksum, switched off) gives 409 noUpdate', async () => {
    const makers: (() => Promise<Ctx>)[] = [
      () => setup({ update: null }).make(),
      () => setup({ update: { ...NEWER, sha256: undefined as unknown as string } }).make(),
      async () => { const c = await setup().make(); c.settings.patch({ updates: { check: false } }); return c; },
    ];
    for (const make of makers) {
      const res = await apply(await make());
      expect([res.statusCode, res.json().error.reason]).toEqual([409, 'noUpdate']);
    }
  });

  it('a failed download/checksum: progress failed with the reason, activity cleared, nothing spawned, server stays', async () => {
    const s = setup();
    const ctx = await s.make();
    await apply(ctx);
    s.updater.finish(new AppError('CONFLICT', 'sha256 differs', 'updateChecksum'));
    await tick();
    expect(await progress(ctx)).toEqual({ state: 'failed', error: 'updateChecksum' });
    expect(ctx.activity.active()).not.toContain('update');
    expect(s.spawned).toEqual([]);
    expect(ctx.shutdownCalls()).toBe(0);
    // And it can be tried again.
    expect((await apply(ctx)).statusCode).toBe(202);
  });

  it('a spawn that fails to start leaves the old app running: failed/updateStart, update folder removed', async () => {
    const s = setup();
    const ctx = await makeApp({ update: NEWER, updateApply: { updater: s.updater, statusFile: s.statusFile, outcome: new UpdateOutcome({}), spawn: async () => { throw new Error('boom'); } } });
    await apply(ctx);
    s.updater.finish({ releaseRoot: 'C:\\r' });
    await tick();
    expect(await progress(ctx)).toEqual({ state: 'failed', error: 'updateStart' });
    expect(ctx.shutdownCalls()).toBe(0);
    expect(ctx.activity.active()).not.toContain('update');
  });

  it('a failed start removes the unpacked update folder', async () => {
    const s = setup();
    const ctx = await makeApp({ update: NEWER, updateApply: { updater: s.updater, statusFile: s.statusFile, outcome: new UpdateOutcome({}), spawn: async () => { throw new Error('ENOENT'); } } });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'update-'));
    fs.mkdirSync(path.join(work, 'release'));
    await apply(ctx);
    s.updater.finish({ releaseRoot: path.join(work, 'release') });
    await tick();
    expect(fs.existsSync(work)).toBe(false);
  });

  it('while an update runs, sending, search, package jobs, mailbox changes and restore are refused (updateRunning)', async () => {
    const ctx = await makeApp();
    const id = pkg().id;
    const vacancyId = vacancy().id;
    const mail = { to: 'hr@firma.de', subject: 'Bewerbung', body: 'Hallo' };
    const made = (await ctx.app.inject({ method: 'POST', url: '/api/backups', headers: H })).json() as { name: string };
    const end = ctx.activity.begin('update');
    const calls: [string, string, unknown?][] = [
      ['POST', `/api/applications/${id}/send`, mail],
      ['POST', '/api/vacancies/search'],
      ['POST', '/api/applications', { vacancyId, language: 'de' }],
      ['DELETE', '/api/mail/settings'],
      ['POST', '/api/backups/restore', { name: made.name }],
      ['PUT', '/api/backups/folder', { folder: null }],
    ];
    for (const [method, url, payload] of calls) {
      const res = await ctx.app.inject({ method: method as 'POST', url, headers: H, ...(payload ? { payload: payload as object } : {}) });
      expect([url, res.statusCode, res.json().error?.reason]).toEqual([url, 409, 'updateRunning']);
    }
    expect(ctx.mailer.sent).toEqual([]);
    end();
  });
});

describe('GET /api/updates after an update', () => {
  it('reports justUpdated once', async () => {
    const s = setup({ outcome: new UpdateOutcome({ justUpdated: '9.9.9' }) });
    const ctx = await s.make();
    const get = async () => (await ctx.app.inject({ method: 'GET', url: '/api/updates', headers: H })).json();
    expect((await get()).justUpdated).toBe('9.9.9');
    expect(await get()).not.toHaveProperty('justUpdated');
  });

  it('the real order: "running" at start, "done" later: updatePending first, then justUpdated once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-outcome-'));
    const file = path.join(dir, 'update-status.json');
    const status = (state: string) => fs.writeFileSync(file, JSON.stringify({ state, step: 'starting', from: '0.10.1', to: '9.9.9', at: new Date().toISOString() }));
    status('running');
    const ctx = await setup({ outcome: readUpdateOutcome(file, nullLogger) }).make();
    const get = async () => (await ctx.app.inject({ method: 'GET', url: '/api/updates', headers: H })).json();
    expect((await get()).updatePending).toBe(true);
    status('done');
    const done = await get();
    expect([done.justUpdated, done.updatePending]).toEqual(['9.9.9', undefined]);
    expect(await get()).not.toHaveProperty('justUpdated');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a rolled-back update is reported once as lastUpdateError', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-outcome-'));
    const file = path.join(dir, 'update-status.json');
    fs.writeFileSync(file, JSON.stringify({ state: 'rolledBack', step: 'installing', from: '0.10.1', to: '9.9.9', error: 'npm ci failed', at: new Date().toISOString() }));
    const s = setup({ outcome: readUpdateOutcome(file, nullLogger) });
    const ctx = await s.make();
    const get = async () => (await ctx.app.inject({ method: 'GET', url: '/api/updates', headers: H })).json();
    expect((await get()).lastUpdateError).toBe('failed');
    expect(await get()).not.toHaveProperty('lastUpdateError');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('readUpdateOutcome', () => {
  let dir: string;
  let file: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-outcome-')); file = path.join(dir, 'update-status.json'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const write = (o: object, bom = false) => fs.writeFileSync(file, (bom ? '\uFEFF' : '') + JSON.stringify(o));
  const NOW = Date.parse('2026-11-03T12:00:00Z');
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it('no file means nothing', () => {
    expect(readUpdateOutcome(file, nullLogger, () => NOW).take()).toEqual({});
  });
  it('done gives justUpdated, the file is deleted, handed out once; a BOM is fine', () => {
    write({ state: 'done', step: 'starting', from: '0.10.1', to: '0.11.0', at: at(1000) }, true);
    const o = readUpdateOutcome(file, nullLogger, () => NOW);
    expect(fs.existsSync(file)).toBe(false);
    expect(o.take()).toEqual({ justUpdated: '0.11.0' });
    expect(o.take()).toEqual({});
  });
  it('failed and rolledBack give failed; "rollback failed" gives rollbackFailed', () => {
    write({ state: 'failed', step: 'installing', error: 'copy failed', at: at(1000) });
    expect(readUpdateOutcome(file, nullLogger, () => NOW).take()).toEqual({ lastUpdateError: 'failed' });
    write({ state: 'rolledBack', step: 'installing', error: 'npm', at: at(1000) });
    expect(readUpdateOutcome(file, nullLogger, () => NOW).take()).toEqual({ lastUpdateError: 'failed' });
    write({ state: 'failed', step: 'installing', error: 'rollback failed: copy', at: at(1000) });
    expect(readUpdateOutcome(file, nullLogger, () => NOW).take()).toEqual({ lastUpdateError: 'rollbackFailed' });
  });
  it('running for over 10 minutes gives interrupted (file deleted); younger is ignored and left', () => {
    write({ state: 'running', step: 'installing', at: at(11 * 60_000) });
    expect(readUpdateOutcome(file, nullLogger, () => NOW).take()).toEqual({ lastUpdateError: 'interrupted' });
    expect(fs.existsSync(file)).toBe(false);
    write({ state: 'running', step: 'installing', at: at(60_000) });
    expect(readUpdateOutcome(file, nullLogger, () => NOW).take()).toEqual({ updatePending: true });
    expect(fs.existsSync(file)).toBe(true);
  });
  it('the real order: running at start, later done: the next take reports it once', () => {
    write({ state: 'running', step: 'starting', from: '0.10.1', to: '0.11.0', at: at(1000) });
    const o = readUpdateOutcome(file, nullLogger, () => NOW);
    expect(o.take()).toEqual({ updatePending: true });
    expect(o.take()).toEqual({ updatePending: true });
    write({ state: 'done', step: 'starting', from: '0.10.1', to: '0.11.0', at: at(500) });
    expect(o.take()).toEqual({ justUpdated: '0.11.0' });
    expect(fs.existsSync(file)).toBe(false);
    expect(o.take()).toEqual({});
  });
  it('no file at start, a rolledBack file appears later: reported once', () => {
    const o = readUpdateOutcome(file, nullLogger, () => NOW);
    expect(o.take()).toEqual({});
    write({ state: 'rolledBack', step: 'starting', error: 'x', at: at(500) });
    expect(o.take()).toEqual({ lastUpdateError: 'failed' });
    expect(o.take()).toEqual({});
  });
  it('a garbage file is removed and ignored', () => {
    fs.writeFileSync(file, '{nope');
    expect(readUpdateOutcome(file, nullLogger, () => NOW).take()).toEqual({});
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('cleanOldUpdateFolders', () => {
  it('removes update-* folders older than 30 minutes and nothing else', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-clean-'));
    const old = path.join(dir, 'update-old');
    const fresh = path.join(dir, 'update-new');
    const other = path.join(dir, 'keep-old');
    for (const d of [old, fresh, other]) fs.mkdirSync(d);
    const longAgo = new Date(Date.now() - 31 * 60_000);
    fs.utimesSync(old, longAgo, longAgo);
    fs.utimesSync(other, longAgo, longAgo);
    cleanOldUpdateFolders(dir, nullLogger);
    expect(fs.readdirSync(dir).sort()).toEqual(['keep-old', 'update-new']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('a missing folder is fine', () => {
    expect(() => cleanOldUpdateFolders(path.join(os.tmpdir(), 'bp-does-not-exist-x'), nullLogger)).not.toThrow();
  });
});

describe('installerEnv', () => {
  it('removes every BP_* variable and keeps the rest', () => {
    const env = installerEnv({ BP_DATA_DIR: 'x', bp_demo_language: 'de', BP_FAKE_MAIL: '1', PATH: 'p', LOCALAPPDATA: 'l' });
    expect(env).toEqual({ PATH: 'p', LOCALAPPDATA: 'l' });
  });
  it('the spawned installer never sees BP_* even when the server has them', async () => {
    process.env.BP_TEST_LEAK = '1';
    try {
      const s = setup();
      const ctx = await s.make();
      await apply(ctx);
      s.updater.finish({ releaseRoot: 'C:/x/update-1/release' });
      await tick();
      expect(Object.keys((s.spawned[0].opts as { env: object }).env)).not.toContain('BP_TEST_LEAK');
    } finally { delete process.env.BP_TEST_LEAK; }
  });
});

describe('the installer must confirm it took over', () => {
  const tryApply = async (spawn: (statusFile: string) => Promise<{ kill?: () => void } | void>, wait = 300, poll?: number) => {
    const s = setup();
    const statusFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp-handover-')), 'update-status.json');
    const ctx = await makeApp({ update: NEWER, updateApply: { updater: s.updater, statusFile, outcome: new UpdateOutcome({}), spawn: () => spawn(statusFile), startWaitMs: wait, startPollMs: poll } });
    await apply(ctx);
    s.updater.finish({ releaseRoot: 'C:/x/update-1/release' });
    return { ctx, statusFile };
  };

  it('no status within the wait: no shutdown, failed/updateStart, activity cleared, the child is stopped', async () => {
    let killed = 0;
    const { ctx } = await tryApply(async () => ({ kill: () => { killed++; } }), 250);
    await new Promise((r) => setTimeout(r, 700));
    expect(await progress(ctx)).toEqual({ state: 'failed', error: 'updateStart' });
    expect(ctx.shutdownCalls()).toBe(0);
    expect(ctx.activity.active()).not.toContain('update');
    expect(killed).toBe(1);
  });

  it('an old running file from an earlier run does not count', async () => {
    const { ctx } = await tryApply(async (f) => {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ state: 'running', step: 'installing', at: new Date(Date.now() - 60_000).toISOString() }));
    }, 250);
    await new Promise((r) => setTimeout(r, 700));
    expect((await progress(ctx)).state).toBe('failed');
    expect(ctx.shutdownCalls()).toBe(0);
  });

  it('a status written during the last poll interval still counts (the loop looks before the deadline check): no kill', async () => {
    let killed = 0;
    // Wait 300 ms but poll only every 1000 ms: the report (at ~400 ms) lands after the deadline, before the last look.
    const { ctx } = await tryApply(async (f) => { setTimeout(() => writeRunning(f), 400); return { kill: () => { killed++; } }; }, 300, 1000);
    await new Promise((r) => setTimeout(r, 1500));
    expect(killed).toBe(0);
    expect(ctx.shutdownCalls()).toBe(1);
  });

  it('a status that appears a little later is enough: then the server shuts down', async () => {
    const { ctx } = await tryApply(async (f) => { setTimeout(() => writeRunning(f), 150); }, 2000);
    await new Promise((r) => setTimeout(r, 700));
    expect(ctx.shutdownCalls()).toBe(1);
    expect((await progress(ctx)).state).toBe('installing');
  });
});

describe('the demo copy and one-click update', () => {
  it('in the demo copy: canInstall is false and apply gives 409 noUpdate', async () => {
    const s = setup();
    const ctx = await makeApp({ update: NEWER, demo: { active: true }, updateApply: { updater: s.updater, statusFile: s.statusFile, outcome: new UpdateOutcome({}), spawn: async () => undefined } });
    const view = (await ctx.app.inject({ method: 'GET', url: '/api/updates', headers: H })).json();
    expect(view.available.canInstall).toBe(false);
    const res = await apply(ctx);
    expect([res.statusCode, res.json().error.reason]).toEqual([409, 'noUpdate']);
    expect(s.spawned).toEqual([]);
  });

  it('in the real app: a running demo copy gives 409 busy with what = demo; nothing starts', async () => {
    const s = setup();
    let demoUp = true;
    const ctx = await makeApp({
      update: NEWER, demoRunning: () => demoUp,
      updateApply: { updater: s.updater, statusFile: s.statusFile, outcome: new UpdateOutcome({}), spawn: async () => undefined },
    });
    const res = await apply(ctx);
    expect([res.statusCode, res.json().error.reason, res.json().error.params]).toEqual([409, 'busy', { what: 'demo' }]);
    expect(ctx.activity.active()).not.toContain('update');
    demoUp = false;
    expect((await apply(ctx)).statusCode).toBe(202);
  });
});

describe('browser work and AI-helper install are refused during an update', () => {
  it('the contact window and the install route answer 409 updateRunning', async () => {
    const ctx = await makeApp();
    ctx.vacancyStore.add(vacancy({ id: 'aa1' }), 'Text');
    const end = ctx.activity.begin('update');
    const calls: [string, string, object][] = [
      ['POST', '/api/llm/install', { provider: 'claude' }],
      ['POST', `/api/vacancies/aa1/contact/find`, { from: 'aa' }],
    ];
    for (const [method, url, payload] of calls) {
      const res = await ctx.app.inject({ method: method as 'POST', url, headers: H, payload });
      expect([url, res.statusCode, res.json().error?.reason]).toEqual([url, 409, 'updateRunning']);
    }
    end();
  });
});
