import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { FakeProvider } from '../src/llm/fake.js';
import { AppError } from '../src/errors.js';
import { H, makeApp } from './helpers/app.js';

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
      provider: 'claude', availability: { ok: false, reason: 'not-logged-in' }, queue: { running: false, queued: 0 },
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
  it('GET /api/llm/check?provider=chatgpt checks that provider and names it', async () => {
    const { app, chatgpt } = await makeApp();
    chatgpt.availability = { ok: false, reason: 'not-installed' };
    const r = await app.inject({ method: 'GET', url: '/api/llm/check?provider=chatgpt', headers: H });
    expect(r.json()).toMatchObject({ provider: 'chatgpt', availability: { ok: false, reason: 'not-installed' } });
  });
  it('GET /api/llm/check without a param uses the current provider (claude in test apps)', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/llm/check', headers: H })).json()).toMatchObject({ provider: 'claude' });
  });
  it('GET /api/llm/check with no provider chosen answers provider null without throwing', async () => {
    const { app } = await makeApp({ chosen: null });
    const r = await app.inject({ method: 'GET', url: '/api/llm/check', headers: H });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ provider: null, availability: { ok: false, reason: 'error' }, queue: { running: false, queued: 0 } });
  });
  it('POST /api/llm/open-login {provider: chatgpt} opens ChatGPT', async () => {
    const { app, chatgpt, provider } = await makeApp();
    await app.inject({ method: 'POST', url: '/api/llm/open-login', headers: H, payload: { provider: 'chatgpt' } });
    expect(chatgpt.loginOpened).toBe(1);
    expect(provider.loginOpened).toBe(0);
  });
  it('POST /api/llm/open-login with no provider chosen and none named -> LLM_NOT_CHOSEN', async () => {
    const { app } = await makeApp({ chosen: null });
    const r = await app.inject({ method: 'POST', url: '/api/llm/open-login', headers: H, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('LLM_NOT_CHOSEN');
  });
  it('AI routes answer LLM_NOT_CHOSEN when no provider is chosen', async () => {
    const { app, provider, chatgpt, settings } = await makeApp({ chosen: null });
    expect(settings.get().llm.provider).toBeNull();
    const r = await app.inject({ method: 'POST', url: '/api/llm/test', headers: H, payload: { language: 'en' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('LLM_NOT_CHOSEN');
    expect(provider.calls).toHaveLength(0);
    expect(chatgpt.calls).toHaveLength(0);
  });
  it('restart with a settings v2 file and no AI helper chosen keeps every AI route on LLM_NOT_CHOSEN', async () => {
    const { app, provider, chatgpt, vacancyStore } = await makeApp({
      settingsFile: {
        schemaVersion: 2, language: 'en', onboarding: { currentStep: null, completed: true },
        llm: { timeoutSec: 180, provider: null }, vacancies: { publishedWithinDays: 14 }, mail: null,
      },
    });
    const s = await app.inject({ method: 'GET', url: '/api/settings', headers: H });
    expect(s.json().llm).toEqual({ timeoutSec: 180, provider: null });
    expect(s.json().onboarding.completed).toBe(true);
    const test = await app.inject({ method: 'POST', url: '/api/llm/test', headers: H, payload: { language: 'en' } });
    expect(test.statusCode).toBe(409);
    expect(test.json().error.code).toBe('LLM_NOT_CHOSEN');
    // A real feature route that goes through the queue: pasting a job offer.
    const paste = await app.inject({ method: 'POST', url: '/api/vacancies/manual', headers: H, payload: { text: 'Wir suchen eine Frontend-Entwicklerin (m/w/d) in Dresden. '.repeat(8) } });
    expect(paste.statusCode).toBe(409);
    expect(paste.json().error.code).toBe('LLM_NOT_CHOSEN');
    expect(vacancyStore.list()).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
    expect(chatgpt.calls).toHaveLength(0);
  });
  it('POST /api/llm/install accepts only a provider id', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'POST', url: '/api/llm/install', headers: H, payload: { provider: 'chatgpt', package: 'evil' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/llm/install', headers: H, payload: { provider: 'x' } })).statusCode).toBe(400);
  });
  it('POST /api/llm/install starts the (fake) installer with 202, GET reports it, a second POST is 409', async () => {
    const { app } = await makeApp({ installMode: 'hang' });
    const r = await app.inject({ method: 'POST', url: '/api/llm/install', headers: H, payload: { provider: 'chatgpt' } });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ state: 'running', provider: 'chatgpt' });
    expect((await app.inject({ method: 'GET', url: '/api/llm/install', headers: H })).json()).toMatchObject({ state: 'running', provider: 'chatgpt' });
    expect((await app.inject({ method: 'POST', url: '/api/llm/install', headers: H, payload: { provider: 'claude' } })).statusCode).toBe(409);
  });
  it('PATCH /api/settings switches the provider for the next request', async () => {
    const { app, chatgpt, provider } = await makeApp();
    await app.inject({ method: 'PATCH', url: '/api/settings', headers: H, payload: { llm: { provider: 'chatgpt' } } });
    await app.inject({ method: 'POST', url: '/api/llm/test', headers: H, payload: { language: 'en' } });
    expect(chatgpt.calls).toHaveLength(1);
    expect(provider.calls).toHaveLength(0);
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
    let port = 0;
    const { app } = await makeApp({ provider, allowedHosts: () => [`127.0.0.1:${port}`] });
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

describe('PATCH /api/settings vacancies', () => {
  it('accepts an allowed number of days and refuses others', async () => {
    const { app } = await makeApp();
    const ok = await app.inject({ method: 'PATCH', url: '/api/settings', headers: H, payload: { vacancies: { publishedWithinDays: 3 } } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().vacancies).toEqual({ publishedWithinDays: 3 });
    const bad = await app.inject({ method: 'PATCH', url: '/api/settings', headers: H, payload: { vacancies: { publishedWithinDays: 4 } } });
    expect(bad.statusCode).toBe(400);
  });
});

describe('security headers', () => {
  const expectHeaders = (headers: Record<string, unknown>) => {
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toBe("default-src 'self'; img-src 'self' blob:; frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
  };
  it('forbids framing and sniffing on the dashboard page', async () => {
    const web = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-web-'));
    fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>BP</title>');
    const { app } = await makeApp({ webDist: web });
    expectHeaders((await app.inject({ method: 'GET', url: '/' })).headers);
    expectHeaders((await app.inject({ method: 'GET', url: '/settings' })).headers);
  });
  it('sets them on API answers and on errors too', async () => {
    const { app } = await makeApp();
    expectHeaders((await app.inject({ method: 'GET', url: '/api/health' })).headers);
    expectHeaders((await app.inject({ method: 'GET', url: '/api/nope' })).headers);
    expectHeaders((await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example:80' } })).headers);
  });
});
