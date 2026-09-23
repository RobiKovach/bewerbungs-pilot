import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { SettingsStore } from '../src/data/settings.js';
import { FakeProvider } from '../src/llm/fake.js';
import { LlmQueue } from '../src/llm/queue.js';
import { AppError } from '../src/errors.js';
import { nullLogger } from '../src/log.js';

const H = { 'x-bp-client': '1' };

async function makeApp(opts: { provider?: FakeProvider; webDist?: string | null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-app-'));
  const settings = new SettingsStore(path.join(dir, 'settings.json'));
  settings.load();
  const provider = opts.provider ?? new FakeProvider();
  let shutdownCalls = 0;
  const app = await buildApp({
    settings, provider, queue: new LlmQueue(provider), logger: nullLogger, version: '0.1.0',
    webDist: opts.webDist ?? null,
    allowedHosts: () => ['localhost:80'],
    onShutdown: () => { shutdownCalls++; },
  });
  return { app, provider, settings, shutdownCalls: () => shutdownCalls };
}

describe('guards', () => {
  it('rejects foreign Host headers', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example:80' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });
  it('rejects state-changing calls without the client header', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/shutdown', payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });
  it('rejects an encoded/obfuscated path that still routes to an API handler, without the client header', async () => {
    const { app, shutdownCalls } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/%61pi/shutdown', payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BAD_REQUEST');
    expect(shutdownCalls()).toBe(0);
  });
  it('allows HEAD requests without the client header', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'HEAD', url: '/api/health' });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('api', () => {
  it('reports health', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true, app: 'bewerbungs-pilot', version: '0.1.0' });
  });
  it('reads and patches settings', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).json().language).toBeNull();
    const res = await app.inject({ method: 'PATCH', url: '/api/settings', headers: H, payload: { language: 'pl', onboarding: { currentStep: 'claude' } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ language: 'pl', onboarding: { currentStep: 'claude', completed: false } });
  });
  it('refuses an unsupported language', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'PATCH', url: '/api/settings', headers: H, payload: { language: 'fr' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });
  it('checks Claude and shows the queue', async () => {
    const { app } = await makeApp({ provider: new FakeProvider({ ok: false, reason: 'not-logged-in' }) });
    expect((await app.inject({ method: 'GET', url: '/api/llm/check?refresh=1' })).json()).toEqual({
      availability: { ok: false, reason: 'not-logged-in' }, queue: { running: false, queued: 0 },
    });
  });
  it('runs the test task in the requested language', async () => {
    const { app, provider } = await makeApp({ provider: new FakeProvider({ ok: true }, () => ({ greeting: 'Hallo!' })) });
    const res = await app.inject({ method: 'POST', url: '/api/llm/test', headers: H, payload: { language: 'de' } });
    expect(res.json()).toEqual({ greeting: 'Hallo!' });
    expect(provider.calls[0].replyLanguage).toBe('de');
  });
  it('maps AppError codes to HTTP errors', async () => {
    const { app } = await makeApp({ provider: new FakeProvider({ ok: true }, () => { throw new AppError('LLM_TIMEOUT', 'slow'); }) });
    const res = await app.inject({ method: 'POST', url: '/api/llm/test', headers: H, payload: { language: 'en' } });
    expect(res.statusCode).toBe(504);
    expect(res.json()).toEqual({ error: { code: 'LLM_TIMEOUT', detailsForLog: 'slow' } });
  });
  it('maps unexpected errors to UNKNOWN', async () => {
    const { app } = await makeApp({ provider: new FakeProvider({ ok: true }, () => { throw new Error('kaputt'); }) });
    const res = await app.inject({ method: 'POST', url: '/api/llm/test', headers: H, payload: { language: 'en' } });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('UNKNOWN');
  });
  it('opens the Claude sign-in window', async () => {
    const { app, provider } = await makeApp();
    expect((await app.inject({ method: 'POST', url: '/api/llm/open-login', headers: H, payload: {} })).json()).toEqual({ ok: true });
    expect(provider.loginOpened).toBe(1);
  });
  it('answers shutdown first, then shuts down', async () => {
    const { app, shutdownCalls } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/shutdown', headers: H, payload: {} });
    expect(res.json()).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(shutdownCalls()).toBe(1);
  });
  it('returns NOT_FOUND JSON for unknown API routes', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
  it('maps malformed JSON bodies to BAD_REQUEST instead of UNKNOWN', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'PATCH', url: '/api/settings', headers: { ...H, 'content-type': 'application/json' }, payload: '{bad',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });
});

describe('cancellation', () => {
  it('aborts the in-flight LLM task when the client disconnects mid-request', async () => {
    let aborted = false;
    const provider = new FakeProvider({ ok: true }, (_task, signal) => new Promise(() => {
      signal.addEventListener('abort', () => { aborted = true; });
    }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-app-'));
    const settings = new SettingsStore(path.join(dir, 'settings.json'));
    settings.load();
    let port = 0;
    const app = await buildApp({
      settings, provider, queue: new LlmQueue(provider), logger: nullLogger, version: '0.1.0',
      webDist: null,
      allowedHosts: () => [`127.0.0.1:${port}`],
      onShutdown: () => {},
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected a network address');
    port = addr.port;

    await new Promise<void>((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port, path: '/api/llm/test', method: 'POST',
        headers: { 'x-bp-client': '1', 'content-type': 'application/json' },
      });
      req.on('error', () => { /* expected: we destroy the socket ourselves below */ });
      req.end(JSON.stringify({ language: 'en' }));
      setTimeout(() => { req.destroy(); resolve(); }, 100);
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(aborted).toBe(true);
    await app.close();
  });
});

describe('static dashboard', () => {
  it('serves index.html at / and for unknown non-API paths', async () => {
    const web = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-web-'));
    fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>BP</title>');
    const { app } = await makeApp({ webDist: web });
    expect((await app.inject({ method: 'GET', url: '/' })).body).toContain('<title>BP</title>');
    expect((await app.inject({ method: 'GET', url: '/something' })).body).toContain('<title>BP</title>');
  });
});
