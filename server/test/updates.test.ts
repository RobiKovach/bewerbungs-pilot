import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UpdateChecker } from '../src/updates/checker.js';
import { UPDATE_URL, isNewer, parseVersionFile, type VersionFile } from '../src/updates/version-file.js';
import type { Logger } from '../src/log.js';
import { H, makeApp } from './helpers/app.js';

const RELEASES = 'https://github.com/RobiKovach/bewerbungs-pilot/releases/';
const valid = (over: Record<string, unknown> = {}) => ({
  schema: 1, latest: '0.9.1', released: '2026-11-02', url: `${RELEASES}tag/v0.9.1`,
  notes: { en: 'Backups and update notice.', de: 'Sicherungen.', uk: 'Копії.' }, ...over,
});

describe('parseVersionFile', () => {
  it('accepts a valid file', () => {
    expect(parseVersionFile(valid())).toEqual(valid());
  });
  it('refuses a wrong schema, a non-semver latest, a foreign or plain-http url', () => {
    expect(parseVersionFile(valid({ schema: 2 }))).toBeNull();
    expect(parseVersionFile(valid({ latest: '1.0' }))).toBeNull();
    expect(parseVersionFile(valid({ latest: 'v1.0.0' }))).toBeNull();
    expect(parseVersionFile(valid({ url: 'https://evil.example/RobiKovach/bewerbungs-pilot/releases/x' }))).toBeNull();
    expect(parseVersionFile(valid({ url: 'http://github.com/RobiKovach/bewerbungs-pilot/releases/x' }))).toBeNull();
    expect(parseVersionFile(valid({ url: 'https://github.com/RobiKovach/bewerbungs-pilot/releases/../../evil/x' }))).toBeNull();
    expect(parseVersionFile(valid({ url: 'https://github.com/RobiKovach/bewerbungs-pilot/releases.evil.example/x' }))).toBeNull();
    expect(parseVersionFile(valid({ url: 42 }))).toBeNull();
  });
  it('refuses anything that is not an object', () => {
    for (const raw of [null, undefined, 'text', 42, [], true]) expect(parseVersionFile(raw)).toBeNull();
  });
  it('keeps HTML in notes as plain text, cut to 300 characters; drops non-text and unknown languages', () => {
    const long = '<b>bold</b> ' + 'x'.repeat(400);
    const got = parseVersionFile(valid({ notes: { en: long, de: 7, fr: 'bonjour', uk: '<script>alert(1)</script>' } }));
    expect(got?.notes.en).toBe(long.slice(0, 300));
    expect(got?.notes.en?.startsWith('<b>bold</b>')).toBe(true);
    expect(got?.notes.uk).toBe('<script>alert(1)</script>');
    expect(got?.notes).not.toHaveProperty('de');
    expect(got?.notes).not.toHaveProperty('fr');
  });
  it('treats missing notes as none', () => {
    expect(parseVersionFile(valid({ notes: undefined }))?.notes).toEqual({});
    expect(parseVersionFile(valid({ notes: 'text' }))?.notes).toEqual({});
  });
});

describe('isNewer', () => {
  it('compares plain x.y.z versions', () => {
    expect(isNewer('0.9.1', '0.9.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.9.0', '0.9.0')).toBe(false);
    expect(isNewer('0.8.5', '0.9.0')).toBe(false);
  });
  it('is false for anything that is not x.y.z', () => {
    expect(isNewer('1.0', '0.9.0')).toBe(false);
    expect(isNewer('1.0.0', 'banana')).toBe(false);
  });
  it('the update address is fixed and has no query', () => {
    expect(UPDATE_URL).toBe('https://robikovach.github.io/bewerbungs-pilot/version.json');
  });
});

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (doc: unknown, status = 200) => new Response(JSON.stringify(doc), { status, headers: { 'content-type': 'application/json' } });

function recLogger() {
  const events: string[] = [];
  const logger: Logger = { info: (e) => events.push(e), warn: (e) => events.push(e), error: (e) => events.push(e) };
  return { logger, events };
}

describe('UpdateChecker', () => {
  let dir: string;
  let stateFile: string;
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-01T10:00:00Z') });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-upd-'));
    stateFile = path.join(dir, 'update-state.json');
  });
  afterEach(() => { vi.useRealTimers(); });

  const make = (f: typeof fetch, opts: { enabled?: () => boolean; logger?: Logger; current?: string } = {}) => new UpdateChecker({
    url: 'https://example.test/version.json', stateFile, currentVersion: opts.current ?? '0.9.0',
    enabled: opts.enabled ?? (() => true), fetch: f, logger: opts.logger ?? recLogger().logger,
  });

  it('waits ~60 s after start, then checks once, then not again for 24 h — also after a restart', async () => {
    const f = fakeFetch(() => json(valid()));
    const c = make(f.fn);
    c.start();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(f.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.calls).toHaveLength(1);
    expect(c.available()).toEqual({ version: '0.9.1', url: `${RELEASES}tag/v0.9.1`, notes: valid().notes });
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(f.calls).toHaveLength(1);
    c.stop();

    // "Restart" (about 1 h after the check): same state file, new checker — nothing until 24 h after the last check.
    const f2 = fakeFetch(() => json(valid()));
    const c2 = make(f2.fn);
    expect(c2.available()?.version).toBe('0.9.1');
    c2.start();
    await vi.advanceTimersByTimeAsync(22 * 3600_000);
    expect(f2.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(f2.calls).toHaveLength(1);
    // …and the next one a day later, not before.
    await vi.advanceTimersByTimeAsync(23 * 3600_000);
    expect(f2.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(f2.calls).toHaveLength(2);
    c2.stop();
  });

  it('sends a plain GET: no query string, no cookies or credentials, a timeout signal', async () => {
    const f = fakeFetch(() => json(valid()));
    const c = make(f.fn);
    await c.checkNow();
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0]!;
    expect(url).toBe('https://example.test/version.json');
    expect(new URL(url).search).toBe('');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.credentials).toBeUndefined();
    expect(JSON.stringify(init?.headers ?? {}).toLowerCase()).not.toContain('cookie');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.body).toBeUndefined();
  });

  it.each([
    ['404', () => new Response('not found', { status: 404 })],
    ['HTML instead of JSON', () => new Response('<html>hi</html>', { status: 200 })],
    ['latest 1.0', () => json(valid({ latest: '1.0' }))],
    ['foreign url', () => json(valid({ url: 'https://evil.example/x' }))],
    ['huge body', () => new Response('{"schema":1,"pad":"' + 'x'.repeat(200_000) + '"}', { status: 200 })],
    ['network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['timeout', () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))],
  ])('%s → no throw, one update_check_failed, previous result kept', async (_name, bad) => {
    const good = make(fakeFetch(() => json(valid())).fn);
    await good.checkNow();
    const { logger, events } = recLogger();
    const c = make(fakeFetch(bad).fn, { logger });
    await expect(c.checkNow()).resolves.toBeUndefined();
    expect(events.filter((e) => e === 'update_check_failed')).toHaveLength(1);
    expect(c.available()?.version).toBe('0.9.1');
  });

  it('switched off → zero requests, even after days', async () => {
    const f = fakeFetch(() => json(valid()));
    const c = make(f.fn, { enabled: () => false });
    c.start();
    await vi.advanceTimersByTimeAsync(3 * 24 * 3600_000);
    expect(f.calls).toHaveLength(0);
    c.stop();
  });

  it('switched on again later → checks without waiting for a restart', async () => {
    let on = false;
    const f = fakeFetch(() => json(valid()));
    const c = make(f.fn, { enabled: () => on });
    c.start();
    await vi.advanceTimersByTimeAsync(2 * 3600_000);
    expect(f.calls).toHaveLength(0);
    on = true;
    await vi.advanceTimersByTimeAsync(2 * 3600_000);
    expect(f.calls).toHaveLength(1);
    c.stop();
  });

  it('available() is null when the latest is not newer than this version', async () => {
    const c = make(fakeFetch(() => json(valid({ latest: '0.9.0' }))).fn);
    await c.checkNow();
    expect(c.available()).toBeNull();
    const older = make(fakeFetch(() => json(valid())).fn, { current: '1.0.0' });
    expect(older.available()).toBeNull();
  });

  it('a broken state file is ignored', async () => {
    fs.writeFileSync(stateFile, '{ not json');
    const f = fakeFetch(() => json(valid()));
    const c = make(f.fn);
    expect(c.available()).toBeNull();
    c.start();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(f.calls).toHaveLength(1);
    c.stop();
  });

  it('stop() before the first check means no request at all', async () => {
    const f = fakeFetch(() => json(valid()));
    const c = make(f.fn);
    c.start();
    c.stop();
    await vi.advanceTimersByTimeAsync(2 * 24 * 3600_000);
    expect(f.calls).toHaveLength(0);
  });
});

describe('updates API', () => {
  const avail = (version: string) => ({ version, url: `${RELEASES}tag/v${version}`, notes: { en: 'English notes', de: 'Deutsche Notizen' } as VersionFile['notes'] });

  it('a newer version is offered with notes in the UI language (fallback English)', async () => {
    const ctx = await makeApp({ update: avail('0.2.0') });
    let res = await ctx.app.inject({ method: 'GET', url: '/api/updates', headers: H });
    expect(res.json()).toEqual({ current: '0.1.0', available: { version: '0.2.0', url: `${RELEASES}tag/v0.2.0`, notes: 'English notes' } });
    ctx.settings.patch({ language: 'de' });
    res = await ctx.app.inject({ method: 'GET', url: '/api/updates', headers: H });
    expect(res.json().available.notes).toBe('Deutsche Notizen');
    ctx.settings.patch({ language: 'uk' });
    res = await ctx.app.inject({ method: 'GET', url: '/api/updates', headers: H });
    expect(res.json().available.notes).toBe('English notes');
  });

  it('dismissed → null until a newer version appears', async () => {
    let update = avail('0.2.0');
    const ctx = await makeApp({ updateSource: () => update });
    const dismiss = await ctx.app.inject({ method: 'POST', url: '/api/updates/dismiss', headers: H, payload: { version: '0.2.0' } });
    expect(dismiss.statusCode).toBe(204);
    expect(ctx.settings.get().updates.dismissedVersion).toBe('0.2.0');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/updates', headers: H })).json().available).toBeNull();
    update = avail('0.3.0');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/updates', headers: H })).json().available.version).toBe('0.3.0');
  });

  it('the same version as this one → null; switched off → null', async () => {
    const same = await makeApp({ update: avail('0.1.0') });
    expect((await same.app.inject({ method: 'GET', url: '/api/updates', headers: H })).json()).toEqual({ current: '0.1.0', available: null });
    const off = await makeApp({ update: avail('0.2.0') });
    off.settings.patch({ updates: { check: false } });
    expect((await off.app.inject({ method: 'GET', url: '/api/updates', headers: H })).json().available).toBeNull();
  });

  it('dismiss refuses anything that is not a version', async () => {
    const ctx = await makeApp();
    for (const payload of [{}, { version: 'latest' }, { version: '1.0' }, { version: '0.2.0', extra: 1 }]) {
      const res = await ctx.app.inject({ method: 'POST', url: '/api/updates/dismiss', headers: H, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('PATCH /api/settings switches the check off and on', async () => {
    const ctx = await makeApp();
    const res = await ctx.app.inject({ method: 'PATCH', url: '/api/settings', headers: H, payload: { updates: { check: false } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().updates).toEqual({ check: false, dismissedVersion: null });
    const bad = await ctx.app.inject({ method: 'PATCH', url: '/api/settings', headers: H, payload: { updates: { dismissedVersion: '9.9.9' } } });
    expect(bad.statusCode).toBe(400);
  });
});
