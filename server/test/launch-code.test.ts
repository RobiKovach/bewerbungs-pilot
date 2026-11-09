import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOSED_SIZE, CODE_TTL_MS, LaunchCodes, proofSize, removeOldLaunchPages, sizedSvg, waitForRedeem } from '../src/runtime/launch-code.js';
import { makeApp, TEST_KEY } from './helpers/app.js';

// probe P (16) + proof Q (6) + secret S (42)
const P = '0123456789abcdef';
const Q = 'c0ffee';
const S = 'a'.repeat(42);
const CODE = P + Q + S;
const TOKEN = P + S;
const OTHER = 'b'.repeat(64);
const C = { 'x-bp-client': '1' };

describe('launch codes ("Starting…" tab, 0.12.0)', () => {
  it('accepts only 64 lowercase hex characters', () => {
    const codes = new LaunchCodes();
    for (const bad of ['', 'a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(63)}g`, 42, null]) expect(codes.register(bad)).toBe(false);
    expect(codes.register(CODE)).toBe(true);
    expect(codes.probe(P)).toEqual(proofSize(CODE));
  });

  it('the image size carries the hidden part Q, both sides within 1..4096', () => {
    expect(proofSize(CODE)).toEqual({ width: 1 + (0xc0ffee >> 12), height: 1 + (0xc0ffee & 0xfff) });
    expect(proofSize(P + '000000' + S)).toEqual({ width: 1, height: 1 });
    expect(proofSize(P + 'ffffff' + S)).toEqual({ width: 4096, height: 4096 });
    expect(CLOSED_SIZE.width).toBeGreaterThan(4096);
    expect(sizedSvg({ width: 3, height: 7 })).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="7"/>');
  });

  it('opens only with P + the secret S, once and only within its time', () => {
    let t = 1_000;
    const codes = new LaunchCodes(() => t);
    codes.register(CODE);
    expect(codes.redeem(P + 'b'.repeat(42))).toBe(false);
    expect(codes.redeem(CODE.slice(0, 58))).toBe(false); // P + Q + part of S
    expect(codes.redeem(TOKEN)).toBe(true);
    expect(codes.redeemed(CODE)).toBe(true);
    expect(codes.redeem(TOKEN)).toBe(false);
    expect(codes.probe(P)).toEqual(CLOSED_SIZE);
    codes.register(OTHER);
    t += CODE_TTL_MS;
    expect(codes.probe(OTHER.slice(0, 16))).toBeNull();
    expect(codes.redeem(OTHER.slice(0, 16) + OTHER.slice(22))).toBe(false);
  });

  it('a cancelled code (the browser was opened directly) answers "closed" and never opens', () => {
    const codes = new LaunchCodes();
    codes.register(CODE);
    codes.cancel(CODE);
    expect(codes.probe(P)).toEqual(CLOSED_SIZE);
    expect(codes.redeem(TOKEN)).toBe(false);
  });

  it('remembers that the page asked; a second code with the same P is refused', () => {
    const codes = new LaunchCodes();
    codes.register(CODE);
    expect(codes.seen(CODE)).toBe(false);
    codes.probe(P);
    expect(codes.seen(CODE)).toBe(true);
    expect(codes.register(P + 'f'.repeat(48))).toBe(false);
    expect(codes.register(CODE)).toBe(true);
  });

  it('keeps at most 20 codes waiting', () => {
    const codes = new LaunchCodes();
    for (let i = 0; i < 20; i++) expect(codes.register(i.toString(16).padStart(16, '0') + 'e'.repeat(48))).toBe(true);
    expect(codes.register(CODE)).toBe(false);
  });

  it('waitForRedeem: stops when the tab came, after the time, or a little later when the page was seen', async () => {
    let n = 0;
    expect(await waitForRedeem(() => ++n >= 3, { timeoutMs: 1000, stepMs: 1 })).toBe(true);
    expect(await waitForRedeem(() => false, { timeoutMs: 30, stepMs: 5 })).toBe(false);
    expect(await waitForRedeem(() => { throw new Error('no answer'); }, { timeoutMs: 30, stepMs: 5 })).toBe(false);
    const t0 = Date.now();
    let redeemAt = Infinity;
    const res = await waitForRedeem(() => Date.now() >= redeemAt, { timeoutMs: 40, graceMs: 200, stepMs: 5, seen: () => { redeemAt = t0 + 100; return true; } });
    expect(res).toBe(true);
    const t1 = Date.now();
    expect(await waitForRedeem(() => false, { timeoutMs: 30, graceMs: 60, stepMs: 5, seen: () => true })).toBe(false);
    expect(Date.now() - t1).toBeGreaterThanOrEqual(80);
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

  it('ready.svg names only P and proves Q by its size; never cached, no key needed', async () => {
    const { app, launchCodes } = await setup();
    expect((await app.inject({ method: 'GET', url: `/launch/${P}/ready.svg` })).statusCode).toBe(404);
    launchCodes.register(CODE);
    const res = await app.inject({ method: 'GET', url: `/launch/${P}/ready.svg` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toBe(sizedSvg(proofSize(CODE)));
    expect(res.body).not.toContain(S);
    expect((await app.inject({ method: 'GET', url: `/launch/${CODE}/ready.svg` })).statusCode).toBe(400);
  });

  it('a program on another port sees only P, and P alone (or P + Q) never opens a session', async () => {
    const { app, launchCodes } = await setup();
    launchCodes.register(CODE);
    // What the page sends to every port before any proof: P and nothing else.
    const seenByOtherPorts = `/launch/${P}/ready.svg`;
    expect(seenByOtherPorts).not.toContain(Q);
    expect(seenByOtherPorts).not.toContain(S.slice(0, 8));
    for (const guess of [P, P + Q, `${P}${Q}${'0'.repeat(36)}`, P + '0'.repeat(42)]) {
      const r = await app.inject({ method: 'GET', url: `/launch/${guess}` });
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    expect(launchCodes.probe(P)).toEqual(proofSize(CODE)); // still open for the real page
  });

  it('P + S turns into the session cookie once; the key never appears in an address', async () => {
    const { app, launchCodes } = await setup();
    launchCodes.register(CODE);
    const first = await app.inject({ method: 'GET', url: `/launch/${TOKEN}` });
    expect(first.statusCode).toBe(303);
    expect(first.headers.location).toBe('/');
    expect(first.headers['set-cookie']).toBe(`bp_key_80=${TEST_KEY}; HttpOnly; SameSite=Strict; Path=/`);
    const again = await app.inject({ method: 'GET', url: `/launch/${TOKEN}` });
    expect(again.statusCode).toBe(303);
    expect(again.headers['set-cookie']).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: `/launch/${P}/ready.svg` })).body).toBe(sizedSvg(CLOSED_SIZE));
  });

  it('only the launch key may hand over, ask about or cancel a code', async () => {
    const { app, launchCodes } = await setup();
    const call = (method: 'POST' | 'DELETE', headers: Record<string, string>, code = CODE) => app.inject({ method, url: '/api/launch-code', headers: { ...C, ...headers }, payload: { code } });
    const K = { 'x-bp-key': TEST_KEY };
    expect((await call('POST', {})).statusCode).toBe(401);
    expect((await call('DELETE', {})).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/launch-code/${CODE}` })).statusCode).toBe(401);
    expect((await call('POST', K, 'short')).statusCode).toBe(400);
    expect((await call('POST', K)).json()).toEqual({ ok: true });
    const status = async () => (await app.inject({ method: 'GET', url: `/api/launch-code/${CODE}`, headers: K })).json();
    expect(await status()).toEqual({ redeemed: false, seen: false });
    await app.inject({ method: 'GET', url: `/launch/${P}/ready.svg` });
    expect(await status()).toEqual({ redeemed: false, seen: true });
    expect((await call('DELETE', K)).json()).toEqual({ ok: true });
    expect(launchCodes.redeem(TOKEN)).toBe(false);
    expect(await status()).toEqual({ redeemed: false, seen: true });
  });
});
