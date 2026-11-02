import { describe, it, expect, beforeEach } from 'vitest';
import { handle, type Env } from '../src/index.js';
import { D1Store, MemoryStore, type Mailer, type MailMessage, type Store } from '../src/store.js';
import { sqliteD1 } from './sqlite-d1.js';

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

describe.each([
  ['MemoryStore', () => new MemoryStore()],
  ['D1Store (real SQL)', () => new D1Store(sqliteD1())],
])('admin on %s', (_, make: () => Store) => {
  let store: Store;
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
    store = make();
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

  it('allows 5 wrong attempts; after that the code is dead (and the answer stays the same 401)', async () => {
    await call(form('/admin/code', { email: ROBERT }));
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await call(form('/admin/login', { code: wrong }))).status).toBe(401);
    expect((await call(form('/admin/login', { code: wrong }))).status).toBe(401);
    expect((await call(form('/admin/login', { code }))).status).toBe(401);
    expect(await store.getCode()).toBeNull();
  });

  it('answers byte-identically whether or not the typed address had a code (the admin address stays secret)', async () => {
    const snapshot = async (res: Response) => ({
      status: res.status, body: await res.text(), headers: [...res.headers.entries()].sort(),
    });
    // No code requested at all (someone typed another address).
    const noCode = await snapshot(await call(form('/admin/login', { code: '123456' })));
    // A code for the admin address exists; a wrong guess.
    await call(form('/admin/code', { email: ROBERT }));
    const wrong = lastCode() === '123456' ? '654321' : '123456';
    const wrongGuess = await snapshot(await call(form('/admin/login', { code: wrong })));
    expect(wrongGuess).toEqual(noCode);
    // Expired and used-up codes look the same too.
    now = T0 + 10 * 60_000 + 1;
    expect(await snapshot(await call(form('/admin/login', { code: lastCode() })))).toEqual(noCode);
    now = T0 + 20 * 60_000;
    await call(form('/admin/code', { email: ROBERT }, { 'cf-connecting-ip': '198.51.100.2' }));
    const w = lastCode() === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await call(form('/admin/login', { code: w }));
    expect(await snapshot(await call(form('/admin/login', { code: w })))).toEqual(noCode);
    expect(noCode.status).toBe(401);
  });

  it('a check without any live code costs a slot of the daily budget like a wrong guess', async () => {
    for (let i = 0; i < 10; i++) expect((await call(form('/admin/login', { code: '123456' }))).status).toBe(401);
    expect((await call(form('/admin/login', { code: '123456' }))).status).toBe(429);
  });

  it('refuses a form over 4 KB while reading it', async () => {
    const res = await call(form('/admin/code', { email: ROBERT, pad: 'x'.repeat(5000) }));
    expect(res.status).toBe(400);
    expect(mailer.sent).toHaveLength(0);
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

  it('nobody can sign in when ROBERT_EMAIL is not set, whatever address is typed', async () => {
    for (const email of ['', ROBERT]) {
      const res = await handle(form('/admin/code', { email }), { RESEND_API_KEY: 'k' } as Env, { store, mailer, now: () => now });
      expect(res.status).toBe(200);
    }
    expect(mailer.sent).toHaveLength(0);
    expect(await store.getCode()).toBeNull();
  });

  it('mails at most 20 codes a day, whatever the IPs', async () => {
    for (let i = 0; i < 25; i++) {
      expect((await call(form('/admin/code', { email: ROBERT }, { 'cf-connecting-ip': `198.51.100.${i}` }))).status).toBe(200);
    }
    expect(mailer.sent).toHaveLength(20);
    now = T0 + 24 * 3600_000;
    await call(form('/admin/code', { email: ROBERT }, { 'cf-connecting-ip': '198.51.100.99' }));
    expect(mailer.sent).toHaveLength(21);
  });

  it('parallel wrong logins never get more than 5 checks of one code', async () => {
    await call(form('/admin/code', { email: ROBERT }));
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    // Every answer is the same 401 now, so count the checks the store let through instead.
    let checks = 0;
    const take = store.takeCodeAttempt.bind(store);
    store.takeCodeAttempt = async (...args: Parameters<Store['takeCodeAttempt']>) => {
      const hash = await take(...args);
      if (hash) checks++;
      return hash;
    };
    const res = await Promise.all(Array.from({ length: 9 }, () => call(form('/admin/login', { code: wrong }))));
    expect(checks).toBe(5);
    expect(res.every((r) => r.status === 401)).toBe(true);
    expect((await call(form('/admin/login', { code }))).status).not.toBe(303);
  });

  it('one code makes one session, even with parallel logins', async () => {
    await call(form('/admin/code', { email: ROBERT }));
    const code = lastCode();
    const res = await Promise.all(Array.from({ length: 4 }, () => call(form('/admin/login', { code }))));
    expect(res.filter((r) => r.status === 303)).toHaveLength(1);
  });

  it('allows 10 wrong codes a day over all codes; a new code does not start again', async () => {
    const wrongFor = (code: string) => (code === '000000' ? '111111' : '000000');
    for (let round = 0; round < 2; round++) {
      await call(form('/admin/code', { email: ROBERT }));
      for (let i = 0; i < 5; i++) expect((await call(form('/admin/login', { code: wrongFor(lastCode()) }))).status).toBe(401);
    }
    await call(form('/admin/code', { email: ROBERT }));
    const res = await call(form('/admin/login', { code: lastCode() }));
    expect(res.status).toBe(429);
    expect(await res.text()).toContain('Try again tomorrow');
    // The next UTC day the right code works again.
    now = Date.UTC(2026, 10, 3, 0, 1, 0);
    await call(form('/admin/code', { email: ROBERT }, { 'cf-connecting-ip': '198.51.100.1' }));
    expect((await call(form('/admin/login', { code: lastCode() }))).status).toBe(303);
  });

  it('a right code does not use up the daily wrong-code budget', async () => {
    for (let i = 0; i < 12; i++) {
      await call(form('/admin/code', { email: ROBERT }, { 'cf-connecting-ip': `198.51.100.${i}` }));
      expect((await call(form('/admin/login', { code: lastCode() }))).status).toBe(303);
    }
  });
});
