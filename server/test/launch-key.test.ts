import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cookieName, keyMatches, newLaunchKey, openUrl, readCookie } from '../src/runtime/launch-key.js';
import { makeApp, TEST_KEY } from './helpers/app.js';

const C = { 'x-bp-client': '1' };
const keyless = () => makeApp({ autoKey: false });

describe('launch key helpers', () => {
  it('makes a new long key every time', () => {
    const a = newLaunchKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newLaunchKey()).not.toBe(a);
  });
  it('compares keys safely', () => {
    expect(keyMatches('abc', 'abc')).toBe(true);
    expect(keyMatches('abcd', 'abc')).toBe(false);
    expect(keyMatches('abd', 'abc')).toBe(false);
    expect(keyMatches(undefined, 'abc')).toBe(false);
    expect(keyMatches('', '')).toBe(false);
  });
  it('reads one cookie out of a header', () => {
    expect(readCookie('a=1; bp_key_80=xyz', 'bp_key_80')).toBe('xyz');
    expect(readCookie('bp_key_8080=xyz', 'bp_key_80')).toBeUndefined();
    expect(readCookie(undefined, 'bp_key_80')).toBeUndefined();
  });
  it('names the cookie after the port and builds the open address', () => {
    expect(cookieName(4280)).toBe('bp_key_4280');
    expect(openUrl('127.0.0.1', 4280, 'a+b/c')).toBe('http://127.0.0.1:4280/open?key=a%2Bb%2Fc');
  });
});

describe('API needs the launch key', () => {
  it('refuses data without a key', async () => {
    const { app } = await keyless();
    const res = await app.inject({ method: 'GET', url: '/api/profile', headers: C });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('NO_SESSION');
  });
  it('accepts the key as cookie or as X-BP-Key', async () => {
    const { app } = await keyless();
    expect((await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie: `bp_key_80=${TEST_KEY}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/profile', headers: { 'x-bp-key': TEST_KEY } })).statusCode).toBe(200);
  });
  it('the test helper adds its key only when the test sends none, whatever the header case', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/profile', headers: { 'X-BP-Key': 'wrong' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/profile', headers: { Cookie: 'other=1' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/profile' })).statusCode).toBe(200);
  });
  it('refuses a wrong key', async () => {
    const { app } = await keyless();
    expect((await app.inject({ method: 'GET', url: '/api/profile', headers: { 'x-bp-key': 'nope' } })).statusCode).toBe(401);
  });
  it('cookie name contains the port; another port\'s cookie is rejected', async () => {
    const { app } = await keyless();
    expect((await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie: `bp_key_4281=${TEST_KEY}` } })).statusCode).toBe(401);
  });
  it('does not shut down without a key', async () => {
    const { app, shutdownCalls } = await keyless();
    const res = await app.inject({ method: 'POST', url: '/api/shutdown', headers: C, payload: {} });
    expect(res.statusCode).toBe(401);
    expect(shutdownCalls()).toBe(0);
  });
  it('protects an encoded path that still routes to an API handler', async () => {
    const { app } = await keyless();
    const res = await app.inject({ method: 'GET', url: '/%61pi/profile', headers: C });
    expect(res.statusCode).toBe(401);
  });
  it('gives no data for unknown API paths without a key', async () => {
    const { app } = await keyless();
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).not.toBe(200);
  });
  it('an unknown API path without a key is 401 NO_SESSION (the key is checked before "not found")', async () => {
    const { app } = await keyless();
    const res = await app.inject({ method: 'POST', url: '/api/nope', headers: C, payload: {} });
    expect([res.statusCode, res.json().error.code]).toEqual([401, 'NO_SESSION']);
  });
  it('every registered route except the public ones answers 401 NO_SESSION without a key', async () => {
    const { app } = await keyless();
    // Rebuild full paths from the route tree ("│   ├── /wizard (PUT)" is a child of the line above it).
    const stack: string[] = [];
    const routes: { url: string; methods: string[] }[] = [];
    for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
      const m = /^([│ ]*)[├└]── (\S+) \(([^)]+)\)$/.exec(line.trimEnd());
      if (!m) continue;
      stack.length = m[1].length / 4;
      stack.push(m[2]);
      routes.push({ url: stack.join(''), methods: m[3].split(', ').filter((x) => x !== 'HEAD') });
    }
    const PUBLIC = new Set(['/open', '/api/health', '/oauth/google/callback']);
    const checked = routes.filter((r) => !PUBLIC.has(r.url));
    expect(checked.length).toBeGreaterThan(40);
    for (const r of checked) {
      for (const method of r.methods) {
        const res = await app.inject({ method: method as 'GET', url: r.url.replace(/:\w+/g, 'x1'), headers: C });
        expect([method, r.url, res.statusCode, res.statusCode === 401 ? res.json().error.code : '']).toEqual([method, r.url, 401, 'NO_SESSION']);
      }
    }
  });
  it('answers health without a key', async () => {
    const { app } = await keyless();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, app: 'bewerbungs-pilot', version: '0.1.0' });
  });
  it('google callback works without key', async () => {
    const { app } = await keyless();
    const res = await app.inject({ method: 'GET', url: '/oauth/google/callback?state=x' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
  it('serves the web files without a key', async () => {
    const web = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-web-'));
    fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>BP</title>');
    fs.mkdirSync(path.join(web, 'assets'));
    fs.writeFileSync(path.join(web, 'assets', 'a.js'), 'console.log(1)');
    const { app } = await makeApp({ webDist: web, autoKey: false });
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/assets/a.js' })).statusCode).toBe(200);
  });
  it('a deep link of the app (GET /applications) without a key still gets index.html — the page shows "open via the shortcut"', async () => {
    const web = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-web-'));
    fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>BP</title>');
    const { app } = await makeApp({ webDist: web, autoKey: false });
    const res = await app.inject({ method: 'GET', url: '/applications' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>BP</title>');
  });
});

describe('GET /open', () => {
  it('turns the right key into a session cookie and goes to the app', async () => {
    const { app } = await keyless();
    const res = await app.inject({ method: 'GET', url: `/open?key=${encodeURIComponent(TEST_KEY)}` });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`bp_key_80=${TEST_KEY}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toMatch(/Expires|Max-Age/i);
  });
  it('sets nothing for a wrong or missing key', async () => {
    const { app } = await keyless();
    for (const url of ['/open?key=wrong', '/open']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe('/');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });
});
