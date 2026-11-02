import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../src/data/settings.js';
import type { Logger } from '../src/log.js';
import { shouldPing, UsagePinger } from '../src/usage/pinger.js';
import { CLOUD_URL, cloudUrl } from '../src/usage/cloud.js';
import { H, makeApp } from './helpers/app.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp-usage-'));

function recLogger() {
  const warns: Array<{ event: string; data?: unknown }> = [];
  const logger = { info() {}, error() {}, warn: (event: string, data?: unknown) => { warns.push({ event, data }); } } as unknown as Logger;
  return { logger, warns };
}

interface Call { url: string; init?: RequestInit }
function fakeFetch(answer: (n: number) => Response | Promise<Response> = () => new Response(null, { status: 204 })) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return answer(calls.length);
  }) as typeof fetch;
  return { fn, calls };
}

describe('settings v5 — usage', () => {
  const file = (dir: string) => path.join(dir, 'settings.json');
  const load = (dir: string) => new SettingsStore(file(dir)).load();

  it('a v4 file becomes v5 with the ping on, the notice not shown and a new UUID v4; the id stays the same on the next read', () => {
    const dir = tmpDir();
    fs.writeFileSync(file(dir), JSON.stringify({ schemaVersion: 4, language: 'de', updates: { check: false, dismissedVersion: null } }));
    const first = load(dir);
    expect(first).toMatchObject({ schemaVersion: 5, language: 'de', updates: { check: false }, usage: { ping: true, noticeShown: false } });
    expect(first.usage.installId).toMatch(UUID_V4);
    expect(load(dir).usage.installId).toBe(first.usage.installId);
    expect(JSON.parse(fs.readFileSync(file(dir), 'utf8')).usage.installId).toBe(first.usage.installId);
  });

  it('a fresh install gets an id that survives the next start', () => {
    const dir = tmpDir();
    const first = load(dir);
    expect(first.usage.installId).toMatch(UUID_V4);
    expect(load(dir).usage.installId).toBe(first.usage.installId);
  });

  it('a v5 file with ping:false stays false; a broken id is replaced', () => {
    const dir = tmpDir();
    const id = '3b8f6c3e-5d1a-4b7e-9c2f-0a1b2c3d4e5f';
    fs.writeFileSync(file(dir), JSON.stringify({ schemaVersion: 5, usage: { ping: false, installId: id, noticeShown: true } }));
    expect(load(dir).usage).toEqual({ ping: false, installId: id, noticeShown: true });
    fs.writeFileSync(file(dir), JSON.stringify({ schemaVersion: 5, usage: { ping: false, installId: 'not-a-uuid' } }));
    const u = load(dir).usage;
    expect(u.ping).toBe(false);
    expect(u.installId).toMatch(UUID_V4);
  });

  it('the old-format provider rule is for v1 only: a v5 file with finished onboarding and no helper stays null, also after a v4 round trip', () => {
    const dir = tmpDir();
    fs.writeFileSync(file(dir), JSON.stringify({ schemaVersion: 4, onboarding: { currentStep: null, completed: true }, llm: { timeoutSec: 180, provider: null } }));
    expect(load(dir).llm.provider).toBeNull();
    expect(load(dir).llm.provider).toBeNull();
    fs.writeFileSync(file(dir), JSON.stringify({ schemaVersion: 5, onboarding: { currentStep: null, completed: true }, llm: { timeoutSec: 180, provider: null } }));
    expect(load(dir).llm.provider).toBeNull();
    expect(load(dir).llm.provider).toBeNull();
    fs.writeFileSync(file(dir), JSON.stringify({ onboarding: { currentStep: null, completed: true } }));
    expect(load(dir).llm.provider).toBe('claude');
  });

  it('load({ persist: false }) writes nothing', () => {
    const dir = tmpDir();
    new SettingsStore(file(dir)).load({ persist: false });
    expect(fs.existsSync(file(dir))).toBe(false);
  });

  it('patch changes ping and noticeShown but never the id', () => {
    const dir = tmpDir();
    const s = new SettingsStore(file(dir));
    const before = s.load().usage.installId;
    const next = s.patch({ usage: { ping: false, noticeShown: true } });
    expect(next.usage).toEqual({ ping: false, installId: before, noticeShown: true });
    expect(new SettingsStore(file(dir)).load().usage).toEqual(next.usage);
  });
});

describe('UsagePinger', () => {
  let dir: string;
  let stateFile: string;
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-02T10:00:00Z') });
    dir = tmpDir();
    stateFile = path.join(dir, 'usage-state.json');
  });
  afterEach(() => { vi.useRealTimers(); });

  const make = (f: typeof fetch, opts: { enabled?: () => boolean; logger?: Logger } = {}) => new UsagePinger({
    url: 'https://cloud.test', stateFile, version: '0.11.0', installId: () => 'id-1',
    enabled: opts.enabled ?? (() => true), fetch: f, logger: opts.logger ?? recLogger().logger,
  });

  it('first ping 60 s after start; after a restart 2 h later the next one comes 24 h after the last', async () => {
    const f = fakeFetch();
    const p = make(f.fn);
    p.start();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(f.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.calls).toHaveLength(1);
    p.stop();

    await vi.advanceTimersByTimeAsync(2 * 3600_000);
    const f2 = fakeFetch();
    const p2 = make(f2.fn);
    p2.start();
    await vi.advanceTimersByTimeAsync(21 * 3600_000);
    expect(f2.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3 * 3600_000);
    expect(f2.calls).toHaveLength(1);
    p2.stop();
  });

  it('sends exactly { installId, version } to /v1/ping', async () => {
    const f = fakeFetch();
    await make(f.fn).pingNow();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe('https://cloud.test/v1/ping');
    expect(f.calls[0]!.init?.method).toBe('POST');
    expect(f.calls[0]!.init?.body).toBe('{"installId":"id-1","version":"0.11.0"}');
    expect(f.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends nothing while switched off, and starts as soon as it is switched on', async () => {
    const f = fakeFetch();
    let on = false;
    const p = make(f.fn, { enabled: () => on });
    p.start();
    await vi.advanceTimersByTimeAsync(2 * 3600_000);
    expect(f.calls).toHaveLength(0);
    on = true;
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(f.calls).toHaveLength(1);
    p.stop();
  });

  it('a failing request is one warn line, no throw, and no retry until tomorrow', async () => {
    const { logger, warns } = recLogger();
    const f = fakeFetch(() => { throw new TypeError('fetch failed'); });
    const p = make(f.fn, { logger });
    await expect(p.pingNow()).resolves.toBeUndefined();
    expect(warns.map((w) => w.event)).toEqual(['usage_ping_failed']);
    p.start();
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(f.calls).toHaveLength(1);
    p.stop();
  });

  it('a non-2xx answer is a failure too (one warn)', async () => {
    const { logger, warns } = recLogger();
    await make(fakeFetch(() => new Response('x', { status: 429 })).fn, { logger }).pingNow();
    expect(warns.map((w) => w.event)).toEqual(['usage_ping_failed']);
  });

  it('a ping time in the future (clock moved back) still waits 60 s, not 1 ms and not out of range', async () => {
    fs.writeFileSync(stateFile, JSON.stringify({ lastPingAt: Date.now() + 400 * 24 * 3600_000 }));
    const f = fakeFetch();
    const p = make(f.fn);
    p.start();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(f.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.calls).toHaveLength(1);
    p.stop();
  });

  it('a hanging request is cut after 10 s', async () => {
    const { logger, warns } = recLogger();
    const hang = (async (_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('timeout', 'TimeoutError')));
    })) as typeof fetch;
    const p = make(hang, { logger });
    const done = p.pingNow();
    await vi.advanceTimersByTimeAsync(10_500);
    await done;
    expect(warns.map((w) => w.event)).toEqual(['usage_ping_failed']);
    expect(warns[0]!.data).toEqual({ reason: 'timeout' });
  });
});

describe('shouldPing and the cloud URL', () => {
  it('only a normal run pings: not demo, fake LLM or fake mail', () => {
    expect(shouldPing({ demo: false, fakeLlm: false, fakeMail: false })).toBe(true);
    expect(shouldPing({ demo: true, fakeLlm: true, fakeMail: true })).toBe(false);
    expect(shouldPing({ demo: false, fakeLlm: true, fakeMail: false })).toBe(false);
    expect(shouldPing({ demo: false, fakeLlm: false, fakeMail: true })).toBe(false);
  });
  it('BP_CLOUD_URL overrides the real one', () => {
    expect(cloudUrl({})).toBe(CLOUD_URL);
    expect(cloudUrl({ BP_CLOUD_URL: 'http://127.0.0.1:9/' })).toBe('http://127.0.0.1:9');
  });
});

describe('settings API and POST /api/feedback', () => {
  const body = { kind: 'problem', email: 'max@example.de', text: 'Es geht etwas nicht.' };
  const post = (t: Awaited<ReturnType<typeof makeApp>>, payload: unknown) => t.app.inject({ method: 'POST', url: '/api/feedback', headers: H, payload: payload as object });

  it('GET and PATCH /api/settings never show the install id', async () => {
    const t = await makeApp();
    const got = await t.app.inject({ method: 'GET', url: '/api/settings', headers: H });
    expect(got.json().usage).toEqual({ ping: true, noticeShown: false });
    expect(got.body).not.toContain(t.settings.get().usage.installId);
    const patched = await t.app.inject({ method: 'PATCH', url: '/api/settings', headers: H, payload: { usage: { ping: false, noticeShown: true } } });
    expect(patched.json().usage).toEqual({ ping: false, noticeShown: true });
    expect(patched.body).not.toContain(t.settings.get().usage.installId);
    const bad = await t.app.inject({ method: 'PATCH', url: '/api/settings', headers: H, payload: { usage: { noticeShown: false } } });
    expect(bad.statusCode).toBe(400);
  });

  it('forwards to the cloud with installId, version and the UI language; the Worker 202 becomes 204', async () => {
    const f = fakeFetch(() => new Response('{"ok":true}', { status: 202 }));
    const t = await makeApp({ cloud: { url: 'https://cloud.test', fetch: f.fn } });
    t.settings.patch({ language: 'uk' });
    const res = await post(t, body);
    expect(res.statusCode).toBe(204);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe('https://cloud.test/v1/feedback');
    expect(JSON.parse(String(f.calls[0]!.init?.body))).toEqual({
      installId: t.settings.get().usage.installId, version: '0.1.0', language: 'uk', email: body.email, kind: 'problem', text: body.text,
    });
  });

  it('language falls back to en; it works while the usage ping is switched off', async () => {
    const f = fakeFetch(() => new Response(null, { status: 202 }));
    const t = await makeApp({ cloud: { url: 'https://cloud.test', fetch: f.fn } });
    t.settings.patch({ usage: { ping: false } });
    expect((await post(t, body)).statusCode).toBe(204);
    expect(JSON.parse(String(f.calls[0]!.init?.body)).language).toBe('en');
  });

  it('refuses an extra field and a text over 5 000 characters (400), without calling the cloud', async () => {
    const f = fakeFetch();
    const t = await makeApp({ cloud: { url: 'https://cloud.test', fetch: f.fn } });
    expect((await post(t, { ...body, installId: 'x' })).statusCode).toBe(400);
    expect((await post(t, { ...body, text: 'a'.repeat(5001) })).statusCode).toBe(400);
    expect((await post(t, { ...body, kind: 'spam' })).statusCode).toBe(400);
    expect(f.calls).toHaveLength(0);
    // exactly 5 000 is fine
    expect((await post(t, { ...body, text: 'a'.repeat(5000) })).statusCode).toBe(204);
  });

  it('a bad email or a blank text is a 400 BAD_REQUEST here (the cloud is not called); the email is trimmed', async () => {
    const f = fakeFetch(() => new Response(null, { status: 202 }));
    const t = await makeApp({ cloud: { url: 'https://cloud.test', fetch: f.fn } });
    for (const email of ['x', 'a@b', 'a b@c.de', '', 'a@bcde', 'a@b\u0007.de']) expect((await post(t, { ...body, email })).statusCode).toBe(400);
    // Letters s, p, c and dots must pass (a regex that lost its backslashes rejects these).
    for (const email of ['susi@web.de', 'sasha@gmx.de', 'paul@spp.com', 'robert.kovach@t-online.de']) expect((await post(t, { ...body, email })).statusCode).toBe(204);
    f.calls.length = 0;
    for (const text of ['   ', '\n\t']) expect((await post(t, { ...body, text })).statusCode).toBe(400);
    expect((await post(t, { ...body, text: '😀'.repeat(2600) })).statusCode).toBe(204); // 5 200 UTF-16 units, 2 600 characters
    expect(f.calls).toHaveLength(1);
    f.calls.length = 0;
    expect((await post(t, { ...body, email: '  max@example.de ' })).statusCode).toBe(204);
    expect(JSON.parse(String(f.calls[0]!.init?.body)).email).toBe('max@example.de');
  });

  it('Worker 429 → 502 FEEDBACK_FAILED reason limit', async () => {
    const t = await makeApp({ cloud: { url: 'https://cloud.test', fetch: fakeFetch(() => new Response('{}', { status: 429 })).fn } });
    const res = await post(t, body);
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'FEEDBACK_FAILED', reason: 'limit' });
  });

  it('other Worker errors → reason server; a network error or timeout → reason offline', async () => {
    const t = await makeApp({ cloud: { url: 'https://cloud.test', fetch: fakeFetch(() => new Response('{}', { status: 500 })).fn } });
    const res = await post(t, body);
    expect([res.statusCode, res.json().error.reason]).toEqual([502, 'server']);
    const t2 = await makeApp({ cloud: { url: 'https://cloud.test', fetch: fakeFetch(() => { throw new TypeError('fetch failed'); }).fn } });
    const res2 = await post(t2, body);
    expect([res2.statusCode, res2.json().error.code, res2.json().error.reason]).toEqual([502, 'FEEDBACK_FAILED', 'offline']);
  });
});
