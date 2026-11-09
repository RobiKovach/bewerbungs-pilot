import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_TTL_MS, LaunchCodes, removeOldLaunchPages, waitForRedeem } from '../src/runtime/launch-code.js';
import { makeApp, TEST_KEY } from './helpers/app.js';

const CODE = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const C = { 'x-bp-client': '1' };

describe('launch codes ("Starting…" tab, 0.12.0)', () => {
  it('accepts only 64 lowercase hex characters', () => {
    const codes = new LaunchCodes();
    for (const bad of ['', 'a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(63)}g`, 42, null]) expect(codes.register(bad)).toBe(false);
    expect(codes.register(CODE)).toBe(true);
    expect(codes.pending(CODE)).toBe(true);
  });

  it('works once and only within its time', () => {
    let t = 1_000;
    const codes = new LaunchCodes(() => t);
    codes.register(CODE);
    expect(codes.redeem(OTHER)).toBe(false);
    expect(codes.redeem(CODE)).toBe(true);
    expect(codes.redeemed(CODE)).toBe(true);
    expect(codes.redeem(CODE)).toBe(false);
    codes.register(OTHER);
    t += CODE_TTL_MS;
    expect(codes.pending(OTHER)).toBe(false);
    expect(codes.redeem(OTHER)).toBe(false);
  });

  it('a cancelled code (the browser was opened directly) can no longer open a tab', () => {
    const codes = new LaunchCodes();
    codes.register(CODE);
    codes.cancel(CODE);
    expect(codes.pending(CODE)).toBe(false);
    expect(codes.redeem(CODE)).toBe(false);
  });

  it('keeps at most 20 codes waiting', () => {
    const codes = new LaunchCodes();
    for (let i = 0; i < 20; i++) expect(codes.register(i.toString(16).padStart(64, '0'))).toBe(true);
    expect(codes.register(CODE)).toBe(false);
  });

  it('waitForRedeem stops as soon as the tab came, or after the time', async () => {
    let n = 0;
    expect(await waitForRedeem(() => ++n >= 3, 1000, 1)).toBe(true);
    expect(await waitForRedeem(() => false, 30, 5)).toBe(false);
    expect(await waitForRedeem(() => { throw new Error('no answer'); }, 30, 5)).toBe(false);
  });

  it('removes only the shortcut\'s old pages', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-launch-'));
    const old = path.join(dir, 'starting-0123456789abcdef.html');
    const fresh = path.join(dir, 'starting-fedcba9876543210.html');
    const other = path.join(dir, 'notes.html');
    for (const f of [old, fresh, other]) fs.writeFileSync(f, 'x');
    const past = new Date(Date.now() - 5 * 60_000);
    fs.utimesSync(old, past, past);
    fs.utimesSync(other, past, past);
    removeOldLaunchPages(dir);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
    removeOldLaunchPages(path.join(dir, 'missing'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('launch code routes', () => {
  const setup = async () => {
    const launchCodes = new LaunchCodes();
    const { app } = await makeApp({ autoKey: false, launchCodes });
    return { app, launchCodes };
  };

  it('ready.gif answers only for a waiting code, never cached, without the key', async () => {
    const { app, launchCodes } = await setup();
    expect((await app.inject({ method: 'GET', url: `/launch/${CODE}/ready.gif` })).statusCode).toBe(404);
    launchCodes.register(CODE);
    const res = await app.inject({ method: 'GET', url: `/launch/${CODE}/ready.gif` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'GET', url: '/launch/not-a-code/ready.gif' })).statusCode).toBe(400);
  });

  it('the code turns into the session cookie once; the key itself never appears in the address', async () => {
    const { app, launchCodes } = await setup();
    launchCodes.register(CODE);
    const first = await app.inject({ method: 'GET', url: `/launch/${CODE}` });
    expect(first.statusCode).toBe(303);
    expect(first.headers.location).toBe('/');
    expect(first.headers['set-cookie']).toBe(`bp_key_80=${TEST_KEY}; HttpOnly; SameSite=Strict; Path=/`);
    const again = await app.inject({ method: 'GET', url: `/launch/${CODE}` });
    expect(again.statusCode).toBe(303);
    expect(again.headers['set-cookie']).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: `/launch/${CODE}/ready.gif` })).statusCode).toBe(404);
    const unknown = await app.inject({ method: 'GET', url: `/launch/${OTHER}` });
    expect(unknown.headers['set-cookie']).toBeUndefined();
  });

  it('only the launch key may hand over a code or ask whether it was used', async () => {
    const { app } = await setup();
    const post = (headers: Record<string, string>, code = CODE) => app.inject({ method: 'POST', url: '/api/launch-code', headers: { ...C, ...headers }, payload: { code } });
    expect((await post({})).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/launch-code/${CODE}` })).statusCode).toBe(401);
    expect((await post({ 'x-bp-key': TEST_KEY }, 'short')).statusCode).toBe(400);
    expect((await post({ 'x-bp-key': TEST_KEY })).json()).toEqual({ ok: true });
    const status = () => app.inject({ method: 'GET', url: `/api/launch-code/${CODE}`, headers: { 'x-bp-key': TEST_KEY } });
    expect((await status()).json()).toEqual({ redeemed: false });
    await app.inject({ method: 'GET', url: `/launch/${CODE}` });
    expect((await status()).json()).toEqual({ redeemed: true });
  });
});
