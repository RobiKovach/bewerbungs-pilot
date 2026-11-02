import { describe, it, expect, beforeEach } from 'vitest';
import { handle, type Env } from '../src/index.js';
import { MemoryStore, type Mailer, type MailMessage } from '../src/store.js';

const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);
const ROBERT = 'Robert.Admin@example.com';
const env = { ROBERT_EMAIL: ROBERT, RESEND_API_KEY: 'k' } as Env;
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'";

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(m: MailMessage): Promise<boolean> {
    this.sent.push(m);
    return true;
  }
}

const form = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(`https://bp.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
const get = (cookie?: string) => new Request('https://bp.example/admin', { headers: cookie ? { cookie } : {} });

describe('admin', () => {
  let store: MemoryStore;
  let mailer: FakeMailer;
  let now: number;
  const call = (req: Request) => handle(req, env, { store, mailer, now: () => now });
  const lastCode = () => /(\d{6})/.exec(mailer.sent.at(-1)!.text)![1]!;
  async function signIn(): Promise<string> {
    await call(form('/admin/code', { email: ROBERT }));
    const res = await call(form('/admin/login', { code: lastCode() }));
    return /bp_admin=([^;]+)/.exec(res.headers.get('set-cookie')!)![0];
  }

  beforeEach(() => {
    store = new MemoryStore();
    mailer = new FakeMailer();
    now = T0;
  });

  it('mails a 6-digit code only to the admin address (case and spaces ignored), with the same answer for any address', async () => {
    const other = await call(form('/admin/code', { email: 'someone@example.com' }));
    expect(other.status).toBe(200);
    expect(mailer.sent).toHaveLength(0);
    const right = await call(form('/admin/code', { email: '  robert.admin@EXAMPLE.com ' }));
    expect(right.status).toBe(200);
    expect(await right.text()).toBe(await other.text());
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.text).toMatch(/\b\d{6}\b/);
    expect(mailer.sent[0]!.replyTo).toBeUndefined();
  });

  it('stores only the hash of the code', async () => {
    await call(form('/admin/code', { email: ROBERT }));
    expect(JSON.stringify(await store.getCode())).not.toContain(lastCode());
  });

  it('signs in with the right code: 303 and a strict 12-hour cookie; the code works once', async () => {
    await call(form('/admin/code', { email: ROBERT }));
    const code = lastCode();
    const res = await call(form('/admin/login', { code }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin');
    const cookie = res.headers.get('set-cookie')!;
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=43200']) expect(cookie).toContain(part);
    expect((await call(form('/admin/login', { code }))).status).toBe(401);
  });

  it('refuses an expired code (after 10 minutes)', async () => {
    await call(form('/admin/code', { email: ROBERT }));
    now = T0 + 10 * 60_000 + 1;
    expect((await call(form('/admin/login', { code: lastCode() }))).status).toBe(401);
  });

  it('allows 5 wrong attempts; the 6th is 429 and the code is dead', async () => {
    await call(form('/admin/code', { email: ROBERT }));
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await call(form('/admin/login', { code: wrong }))).status).toBe(401);
    expect((await call(form('/admin/login', { code: wrong }))).status).toBe(429);
    expect((await call(form('/admin/login', { code }))).status).toBe(401);
  });

  it('limits code requests to 5 per IP per hour', async () => {
    for (let i = 0; i < 5; i++) expect((await call(form('/admin/code', { email: 'x@example.com' }))).status).toBe(200);
    expect((await call(form('/admin/code', { email: ROBERT }))).status).toBe(429);
    expect(mailer.sent).toHaveLength(0);
  });

  it('shows the login form without a cookie or with a forged one', async () => {
    for (const res of [await call(get()), await call(get('bp_admin=forged'))]) {
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('action="/admin/code"');
      expect(body).not.toContain('Last 30 days');
    }
  });

  it('shows users, versions and feedback newest first to a signed-in admin, with the text escaped', async () => {
    await store.recordPing('0b6f3c1e-8d2a-4f5b-9c7d-1e2f3a4b5c6d', '0.11.0', '2026-11-02');
    await store.recordPing('1c7a4d2f-9e3b-4a6c-8d8e-2f3a4b5c6d7e', '0.10.1', '2026-10-28');
    const base = { version: '0.11.0', language: 'de', kind: 'problem' as const, email: 'max@example.com' };
    await store.addFeedback({ ...base, createdAt: new Date(T0 - 1000).toISOString(), text: 'older one' });
    await store.addFeedback({ ...base, createdAt: new Date(T0).toISOString(), text: '<script>alert(1)</script>' });
    const cookie = await signIn();
    const body = await (await call(get(cookie))).text();
    expect(body).toMatch(/<div class="n">1<\/div><div class="l">Last day/);
    expect(body).toMatch(/<div class="n">2<\/div><div class="l">Last 7 days/);
    expect(body).toMatch(/<div class="n">2<\/div><div class="l">Last 30 days/);
    expect(body).toContain('<td>0.10.1</td>');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).not.toContain('<script>');
    expect(body.indexOf('&lt;script&gt;')).toBeLessThan(body.indexOf('older one'));
  });

  it('signs out: the session no longer opens the page', async () => {
    const cookie = await signIn();
    const res = await call(new Request('https://bp.example/admin/logout', { method: 'POST', headers: { cookie } }));
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await (await call(get(cookie))).text()).toContain('action="/admin/code"');
  });

  it('ends the session after 12 hours', async () => {
    const cookie = await signIn();
    now = T0 + 12 * 3600_000 + 1;
    expect(await (await call(get(cookie))).text()).toContain('action="/admin/code"');
  });

  it('sends the security headers on every admin answer', async () => {
    const answers = [
      await call(get()),
      await call(form('/admin/code', { email: 'x@example.com' })),
      await call(form('/admin/login', { code: '123456' })),
      await call(new Request('https://bp.example/admin/code')),
    ];
    for (const res of answers) {
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-security-policy')).toBe(CSP);
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
    expect(answers[3]!.status).toBe(405);
  });

  it('nobody can sign in when ROBERT_EMAIL is not set', async () => {
    const res = await handle(form('/admin/code', { email: '' }), { RESEND_API_KEY: 'k' } as Env, { store, mailer, now: () => now });
    expect(res.status).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });
});
