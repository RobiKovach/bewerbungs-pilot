import { describe, expect, it } from 'vitest';
import type { GoogleSignInStatus, MailSettingsView } from '@bp/shared';
import { AppError } from '../src/errors.js';
import type { Logger } from '../src/log.js';
import { GoogleSignIn, SIGNIN_TTL_MS } from '../src/mail/google-signin.js';
import { H, makeApp } from './helpers/app.js';
import { FakeGoogleAuth } from './helpers/mail.js';

type Ctx = Awaited<ReturnType<typeof makeApp>>;

async function setup(revokeTimeoutMs?: number) {
  const logs: string[] = [];
  const push = (e: string, d?: unknown) => logs.push(JSON.stringify({ e, d }));
  const logger: Logger = { info: push, warn: push, error: push };
  const ctx = await makeApp({ logger, revokeTimeoutMs });
  return { ctx, logs };
}

const start = async (ctx: Ctx) => {
  const r = await ctx.app.inject({ method: 'POST', url: '/api/mail/google/start', headers: H, payload: { address: 'max@gmail.com' } });
  const url = new URL(r.json().url as string);
  return { state: url.searchParams.get('state')!, redirect: url.searchParams.get('redirect_uri')! };
};
const callback = (ctx: Ctx, query: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url: `/oauth/google/callback?${query}`, headers });
const status = async (ctx: Ctx) => (await ctx.app.inject({ method: 'GET', url: '/api/mail/google/status' })).json() as GoogleSignInStatus;
const save = (ctx: Ctx, payload: unknown = { senderName: 'Max Mustermann', language: 'de' }) =>
  ctx.app.inject({ method: 'POST', url: '/api/mail/google/save', headers: H, payload: payload as Record<string, unknown> });

describe('Google sign-in routes', () => {
  it('sign in → callback → ready → test email → saved as kind google', async () => {
    const { ctx, logs } = await setup();
    ctx.googleAuth.exchangeResult = { refreshToken: '1//refresh-secret', email: 'max@gmail.com' };
    const { state, redirect } = await start(ctx);
    expect(redirect).toBe('http://localhost:80/oauth/google/callback');
    expect(state).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(await status(ctx)).toEqual({ state: 'pending' });
    const page = await callback(ctx, `state=${state}&code=4/auth-code-secret`);
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.body).not.toMatch(/auth-code-secret|refresh-secret|max@gmail/);
    expect(ctx.googleAuth.exchanges[0]).toEqual({ code: '4/auth-code-secret', verifier: 'v-1', redirectUri: 'http://localhost:80/oauth/google/callback' });
    expect(await status(ctx)).toEqual({ state: 'ready', email: 'max@gmail.com' });
    const saved = await save(ctx);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ mail: { kind: 'google', address: 'max@gmail.com', senderName: 'Max Mustermann', provider: 'gmail' }, passwordSaved: true });
    expect(ctx.mailer.sent[0]).toMatchObject({ config: { kind: 'google' }, mail: { to: 'max@gmail.com', subject: 'BewerbungsPilot: Test-E-Mail' } });
    expect(await ctx.secrets.load()).toBe('1//refresh-secret');
    expect(JSON.stringify(logs)).not.toMatch(/refresh-secret|auth-code-secret|max@gmail|v-1/);
    expect(await status(ctx)).toEqual({ state: 'idle' });
  });

  it('the login hint is passed only when it looks like an address', async () => {
    const { ctx } = await setup();
    const hints: (string | undefined)[] = [];
    const orig = ctx.googleAuth.authUrl.bind(ctx.googleAuth);
    ctx.googleAuth.authUrl = (o) => { hints.push(o.loginHint); return orig(o); };
    await ctx.app.inject({ method: 'POST', url: '/api/mail/google/start', headers: H, payload: { address: 'max@gmail.com' } });
    await ctx.app.inject({ method: 'POST', url: '/api/mail/google/start', headers: H, payload: { address: 'nonsense' } });
    await ctx.app.inject({ method: 'POST', url: '/api/mail/google/start', headers: H, payload: {} });
    expect(hints).toEqual(['max@gmail.com', undefined, undefined]);
  });

  it('unknown or old state: friendly page, the current attempt is untouched', async () => {
    const { ctx } = await setup();
    const first = await start(ctx);
    const second = await start(ctx);
    const stale = await callback(ctx, `state=${first.state}&code=x`);
    expect(stale.statusCode).toBe(200);
    expect(ctx.googleAuth.exchanges).toHaveLength(0);
    expect(await status(ctx)).toEqual({ state: 'pending' });
    await callback(ctx, `state=${second.state}&code=y`);
    expect((await status(ctx)).state).toBe('ready');
    expect((await callback(ctx, `state=${second.state}&code=y`)).statusCode).toBe(200); // single use
    expect(ctx.googleAuth.exchanges).toHaveLength(1);
  });

  it('access_denied → cancelled; exchange failure → failed with its code; nothing saved', async () => {
    const { ctx } = await setup();
    const a = await start(ctx);
    await callback(ctx, `state=${a.state}&error=access_denied`);
    expect(await status(ctx)).toEqual({ state: 'cancelled' });
    ctx.googleAuth.exchangeResult = new AppError('MAIL_CONNECT', 'google 503');
    const b = await start(ctx);
    await callback(ctx, `state=${b.state}&code=z`);
    expect(await status(ctx)).toEqual({ state: 'failed', code: 'MAIL_CONNECT' });
    expect(ctx.settings.get().mail).toBeNull();
  });

  it('an expired or used code (invalid_grant) shows the failure state, not "sign in again"', async () => {
    const { ctx } = await setup();
    ctx.googleAuth.exchangeResult = new AppError('MAIL_REAUTH', 'google 400 invalid_grant');
    const a = await start(ctx);
    const page = await callback(ctx, `state=${a.state}&code=old`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Sign-in did not work');
    expect(await status(ctx)).toEqual({ state: 'failed', code: 'MAIL_CONNECT' });
  });

  it('"send email" left unticked on Google\'s page: the failure says so (MAIL_SCOPE), nothing is saved', async () => {
    const { ctx } = await setup();
    ctx.googleAuth.exchangeResult = new AppError('MAIL_SCOPE', 'gmail.send not granted');
    const a = await start(ctx);
    await callback(ctx, `state=${a.state}&code=c`);
    expect(await status(ctx)).toEqual({ state: 'failed', code: 'MAIL_SCOPE' });
    expect(ctx.settings.get().mail).toBeNull();
    expect(await ctx.secrets.load()).toBeNull();
  });

  it('the test email is refused for a missing permission: 409 MAIL_SCOPE and the sign-in is dropped (a new one is needed)', async () => {
    const { ctx } = await setup();
    const a = await start(ctx);
    await callback(ctx, `state=${a.state}&code=c`);
    ctx.mailer.failWith = new AppError('MAIL_SCOPE', 'gmail 403 insufficientPermissions');
    const r = await save(ctx, { senderName: 'Max', language: 'en' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('MAIL_SCOPE');
    expect(await status(ctx)).toEqual({ state: 'idle' });
    expect(ctx.settings.get().mail).toBeNull();
    expect(await ctx.secrets.load()).toBeNull();
  });

  it('a callback without a code fails with BAD_REQUEST', async () => {
    const { ctx } = await setup();
    const a = await start(ctx);
    await callback(ctx, `state=${a.state}`);
    expect(await status(ctx)).toEqual({ state: 'failed', code: 'BAD_REQUEST' });
    expect(ctx.googleAuth.exchanges).toHaveLength(0);
  });

  it('the page is shown in the settings language, English by default', async () => {
    const { ctx } = await setup();
    const a = await start(ctx);
    expect((await callback(ctx, `state=${a.state}&error=access_denied`)).body).toContain('<html lang="en">');
    ctx.settings.patch({ language: 'de' });
    const b = await start(ctx);
    expect((await callback(ctx, `state=${b.state}&error=access_denied`)).body).toContain('<html lang="de">');
  });

  it('a failed test email saves nothing and can be retried', async () => {
    const { ctx } = await setup();
    const a = await start(ctx);
    await callback(ctx, `state=${a.state}&code=c`);
    ctx.mailer.failWith = new AppError('MAIL_REAUTH', 'google 401 authError');
    const r = await save(ctx, { senderName: 'Max', language: 'en' });
    expect(r.statusCode).toBe(409);
    expect(ctx.settings.get().mail).toBeNull();
    expect(await ctx.secrets.load()).toBeNull();
    expect((await status(ctx)).state).toBe('ready');
    ctx.mailer.failWith = null;
    expect((await save(ctx, { senderName: 'Max', language: 'en' })).statusCode).toBe(200);
  });

  it('save without a finished sign-in → 409 googleNotSignedIn', async () => {
    const { ctx } = await setup();
    const none = await save(ctx);
    expect(none.statusCode).toBe(409);
    expect(none.json().error.reason).toBe('googleNotSignedIn');
    await start(ctx);
    expect((await save(ctx)).statusCode).toBe(409);
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('disconnect revokes the Google key (best effort) and removes it', async () => {
    const { ctx, logs } = await setup();
    ctx.settings.setMail({ kind: 'google', address: 'max@gmail.com', senderName: 'Max', provider: 'gmail' });
    await ctx.secrets.save('1//refresh-secret');
    ctx.googleAuth.revokeFails = true;
    const r = await ctx.app.inject({ method: 'DELETE', url: '/api/mail/settings', headers: H });
    expect(r.statusCode).toBe(200);
    expect(ctx.settings.get().mail).toBeNull();
    expect(await ctx.secrets.load()).toBeNull();
    expect(ctx.googleAuth.revoked).toEqual(['1//refresh-secret']);
    expect(logs.join('\n')).toContain('google_revoke_failed');
    expect(JSON.stringify(logs)).not.toMatch(/refresh-secret|max@gmail/);
  });

  it('disconnect does not wait for a revoke that never answers: logs it and removes the key anyway', async () => {
    const { ctx, logs } = await setup(50);
    ctx.settings.setMail({ kind: 'google', address: 'max@gmail.com', senderName: 'Max', provider: 'gmail' });
    await ctx.secrets.save('1//refresh-secret');
    ctx.googleAuth.revoke = () => new Promise<void>(() => {});
    const r = await ctx.app.inject({ method: 'DELETE', url: '/api/mail/settings', headers: H });
    expect(r.statusCode).toBe(200);
    expect(ctx.settings.get().mail).toBeNull();
    expect(await ctx.secrets.load()).toBeNull();
    expect(logs.join('\n')).toContain('google_revoke_failed');
    expect(JSON.stringify(logs)).not.toMatch(/refresh-secret|max@gmail/);
  });

  it('disconnecting an SMTP account does not call Google', async () => {
    const { ctx } = await setup();
    ctx.settings.setMail({ kind: 'smtp', address: 'max@example.com', senderName: 'Max', host: 'smtp.example.com', port: 465, security: 'ssl', user: 'max@example.com', provider: 'other' });
    await ctx.secrets.save('geheim123');
    expect((await ctx.app.inject({ method: 'DELETE', url: '/api/mail/settings', headers: H })).statusCode).toBe(200);
    expect(ctx.googleAuth.revoked).toEqual([]);
  });

  it('settings and status never show the refresh token', async () => {
    const { ctx } = await setup();
    ctx.googleAuth.exchangeResult = { refreshToken: '1//refresh-secret', email: 'max@gmail.com' };
    const a = await start(ctx);
    await callback(ctx, `state=${a.state}&code=c`);
    const during = await ctx.app.inject({ method: 'GET', url: '/api/mail/google/status' });
    await save(ctx);
    const after = (await ctx.app.inject({ method: 'GET', url: '/api/mail/settings' })).body;
    expect(during.body).not.toContain('refresh-secret');
    expect(after).not.toContain('refresh-secret');
    expect((JSON.parse(after) as MailSettingsView).passwordSaved).toBe(true);
  });

  it('the callback needs no X-BP-Client header but a foreign Host is refused', async () => {
    const { ctx } = await setup();
    expect((await callback(ctx, 'state=nope&code=x')).statusCode).toBe(200);
    expect((await callback(ctx, 'state=nope&code=x', { host: 'evil.example' })).statusCode).toBe(403);
  });
});

describe('GoogleSignIn', () => {
  it('expires after 10 minutes: status → cancelled, a late callback → unknown', async () => {
    let t = 1_000_000;
    const auth = new FakeGoogleAuth();
    const s = new GoogleSignIn(auth, () => t);
    const url = new URL(await s.start('http://127.0.0.1:4280/oauth/google/callback'));
    const state = url.searchParams.get('state')!;
    t += SIGNIN_TTL_MS;
    expect(s.status()).toEqual({ state: 'pending' });
    t += 1;
    expect(s.status()).toEqual({ state: 'cancelled' });
    expect(await s.callback({ state, code: 'late' })).toBe('unknown');
    expect(auth.exchanges).toHaveLength(0);
    expect(s.tokens()).toBeNull();
  });

  it('tokens() is available only while ready, and clear() resets', async () => {
    const auth = new FakeGoogleAuth();
    const s = new GoogleSignIn(auth);
    const state = new URL(await s.start('http://127.0.0.1:4280/oauth/google/callback')).searchParams.get('state')!;
    expect(s.tokens()).toBeNull();
    expect(await s.callback({ state, code: 'c' })).toBe('ready');
    expect(s.tokens()).toEqual({ refreshToken: '1//fake-refresh', email: 'max@gmail.com' });
    s.clear();
    expect(s.tokens()).toBeNull();
    expect(s.status()).toEqual({ state: 'idle' });
  });
});
