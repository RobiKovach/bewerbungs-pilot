import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handle, type Env } from '../src/index.js';
import { D1Store, MemoryStore, type Mailer, type MailMessage, type Store } from '../src/store.js';
import { sqliteD1 } from './sqlite-d1.js';

const DAY = 24 * 3600_000;
const T0 = Date.UTC(2026, 10, 2, 12, 0, 0); // 2026-11-02 12:00 UTC
const A = '0b6f3c1e-8d2a-4f5b-9c7d-1e2f3a4b5c6d';
const B = '1c7a4d2f-9e3b-4a6c-8d8e-2f3a4b5c6d7e';
const env = {} as Env;

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  answer = true;
  async send(m: MailMessage): Promise<boolean> {
    this.sent.push(m);
    return this.answer;
  }
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://bp.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const feedback = (over: Record<string, unknown> = {}) => ({
  installId: A, version: '0.11.0', language: 'uk', email: 'max@example.com', kind: 'problem',
  text: 'Die Vorschau zeigt nach dem Speichern eine leere Seite.', ...over,
});

describe('worker api', () => {
  let store: MemoryStore;
  let mailer: FakeMailer;
  let now: number;
  const call = (req: Request) => handle(req, env, { store, mailer, now: () => now });

  beforeEach(() => {
    store = new MemoryStore();
    mailer = new FakeMailer();
    now = T0;
  });

  describe('POST /v1/ping', () => {
    it('counts an install once per UTC day', async () => {
      expect((await call(post('/v1/ping', { installId: A, version: '0.11.0' }))).status).toBe(204);
      expect((await call(post('/v1/ping', { installId: A, version: '0.11.0' }))).status).toBe(204);
      expect((await store.stats(now)).users.d1).toBe(1);
    });

    it('writes nothing for a second ping of the same install on the same day', async () => {
      await call(post('/v1/ping', { installId: A, version: '0.11.0' }));
      const record = vi.spyOn(store, 'recordPing');
      const addHit = vi.spyOn(store, 'addHit');
      expect((await call(post('/v1/ping', { installId: A, version: '0.11.0' }))).status).toBe(204);
      expect(record).not.toHaveBeenCalled();
      expect(addHit).not.toHaveBeenCalled();
      now = T0 + DAY;
      await call(post('/v1/ping', { installId: A, version: '0.11.1' }));
      expect(record).toHaveBeenCalledTimes(1);
    });

    it('accepts at most 20 new installs per IP (within 2 hours); known installs keep working', async () => {
      const id = (i: number) => `${(0x20000000 + i).toString(16)}-8d2a-4f5b-9c7d-1e2f3a4b5c6d`;
      for (let i = 0; i < 20; i++) expect((await call(post('/v1/ping', { installId: id(i), version: '0.11.0' }))).status).toBe(204);
      const record = vi.spyOn(store, 'recordPing');
      const addHit = vi.spyOn(store, 'addHit');
      expect((await call(post('/v1/ping', { installId: id(20), version: '0.11.0' }))).status).toBe(429);
      expect(record).not.toHaveBeenCalled();
      expect(addHit).not.toHaveBeenCalled();
      expect((await store.stats(now)).users.d1).toBe(20);
      // Another IP, or a known install from the same IP the next day, still counts.
      expect((await call(post('/v1/ping', { installId: id(21), version: '0.11.0' }, { 'cf-connecting-ip': '198.51.100.50' }))).status).toBe(204);
      now = T0 + DAY;
      expect((await call(post('/v1/ping', { installId: id(0), version: '0.11.0' }))).status).toBe(204);
      expect((await store.stats(now)).users.d1).toBe(1);
      // After the 2-hour window the cap starts over.
      now = T0 + 2 * 3600_000 + 1;
      expect((await call(post('/v1/ping', { installId: id(22), version: '0.11.0' }))).status).toBe(204);
    });

    it('mixes the IP_PEPPER secret into the IP hash when it is set', async () => {
      const addHit = vi.spyOn(store, 'addHit');
      await call(post('/v1/ping', { installId: A, version: '0.11.0' }));
      await handle(post('/v1/ping', { installId: B, version: '0.11.0' }), { IP_PEPPER: 'pepper' } as Env, { store, mailer, now: () => now });
      const [plain, peppered] = addHit.mock.calls.map((c) => c[0]);
      expect(plain).toMatch(/^ip:new:[0-9a-f]{64}$/);
      expect(peppered).toMatch(/^ip:new:[0-9a-f]{64}$/);
      expect(peppered).not.toBe(plain);
      expect(`${plain}${peppered}`).not.toContain('203.0.113.7');
    });

    it('counts users over 1, 7 and 30 days and groups by the last version', async () => {
      await call(post('/v1/ping', { installId: A, version: '0.10.1' }));
      now = T0 + 10 * DAY;
      await call(post('/v1/ping', { installId: B, version: '0.11.0' }));
      const s = await store.stats(now);
      expect(s.users).toEqual({ d1: 1, d7: 1, d30: 2 });
      expect(s.versions).toEqual([{ version: '0.11.0', users: 1 }, { version: '0.10.1', users: 1 }]);
      now = T0 + 11 * DAY;
      await call(post('/v1/ping', { installId: A, version: '0.11.0' }));
      expect((await store.stats(now)).versions).toEqual([{ version: '0.11.0', users: 2 }]);
    });

    it.each([
      ['an extra field', { installId: A, version: '0.11.0', name: 'Max' }],
      ['a bad uuid', { installId: 'not-a-uuid', version: '0.11.0' }],
      ['a non-v4 uuid', { installId: '0b6f3c1e-8d2a-1f5b-9c7d-1e2f3a4b5c6d', version: '0.11.0' }],
      ['a bad version', { installId: A, version: '0.11' }],
      ['a missing field', { installId: A }],
      ['an array', [A, '0.11.0']],
    ])('refuses %s with 400', async (_, body) => {
      expect((await call(post('/v1/ping', body))).status).toBe(400);
      expect((await store.stats(now)).users.d30).toBe(0);
    });

    it('refuses non-JSON and bodies over 16 KB with 400', async () => {
      expect((await call(post('/v1/ping', 'installId=x'))).status).toBe(400);
      expect((await call(post('/v1/ping', JSON.stringify({ installId: A, version: '0.11.0', pad: 'x'.repeat(17 * 1024) })))).status).toBe(400);
    });

    it('answers 405 to other methods and 404 to unknown paths', async () => {
      expect((await call(new Request('https://bp.example/v1/ping'))).status).toBe(405);
      expect((await call(new Request('https://bp.example/v1/ping', { method: 'OPTIONS' }))).status).toBe(405);
      expect((await call(post('/v1/other', {}))).status).toBe(404);
    });
  });

  describe('POST /v1/feedback', () => {
    it('stores the feedback and mails Robert with the person as Reply-To', async () => {
      const res = await call(post('/v1/feedback', feedback()));
      expect(res.status).toBe(202);
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]!.subject).toBe('BewerbungsPilot 0.11.0: Problem — Die Vorschau zeigt nach dem Speichern eine leere Seite.');
      expect(mailer.sent[0]!.replyTo).toBe('max@example.com');
      expect(mailer.sent[0]!.text).toContain('Die Vorschau zeigt nach dem Speichern eine leere Seite.');
      expect(mailer.sent[0]!.text).toContain('max@example.com');
      expect(mailer.sent[0]!.text).toContain('0.11.0');
      const [row] = await store.listFeedback(10);
      expect(row).toMatchObject({ version: '0.11.0', language: 'uk', kind: 'problem', email: 'max@example.com', mailed: true });
      expect(row!.createdAt).toBe(new Date(T0).toISOString());
    });

    it('cuts the subject at 60 characters of the text on one line', async () => {
      await call(post('/v1/feedback', feedback({ kind: 'idea', text: `Line one\r\nBcc: x@evil.example ${'z'.repeat(80)}` })));
      const subject = mailer.sent[0]!.subject;
      expect(subject.startsWith('BewerbungsPilot 0.11.0: Idea — Line one Bcc: x@evil.example')).toBe(true);
      expect(subject).not.toMatch(/[\r\n]/);
      expect(subject.length).toBe('BewerbungsPilot 0.11.0: Idea — '.length + 60);
    });

    it('still accepts the feedback when the mail fails, and marks it as not mailed', async () => {
      mailer.answer = false;
      expect((await call(post('/v1/feedback', feedback()))).status).toBe(202);
      expect((await store.listFeedback(10))[0]!.mailed).toBe(false);
    });

    it('treats a throwing mailer like a failed mail', async () => {
      const broken: Mailer = { send: () => Promise.reject(new Error('down')) };
      const res = await handle(post('/v1/feedback', feedback()), env, { store, mailer: broken, now: () => now });
      expect(res.status).toBe(202);
      expect((await store.listFeedback(10))[0]!.mailed).toBe(false);
    });

    it('allows 5 per install per day, the 6th is 429', async () => {
      for (let i = 0; i < 5; i++) {
        expect((await call(post('/v1/feedback', feedback(), { 'cf-connecting-ip': `198.51.100.${i}` }))).status).toBe(202);
      }
      expect((await call(post('/v1/feedback', feedback(), { 'cf-connecting-ip': '198.51.100.9' }))).status).toBe(429);
      now = T0 + DAY;
      expect((await call(post('/v1/feedback', feedback(), { 'cf-connecting-ip': '198.51.100.9' }))).status).toBe(202);
    });

    it('allows 10 per IP per hour, the 11th is 429', async () => {
      const id = (i: number) => `${(0x10000000 + i).toString(16)}-8d2a-4f5b-9c7d-1e2f3a4b5c6d`;
      for (let i = 0; i < 10; i++) {
        expect((await call(post('/v1/feedback', feedback({ installId: id(i) })))).status).toBe(202);
      }
      expect((await call(post('/v1/feedback', feedback({ installId: id(10) })))).status).toBe(429);
      now = T0 + 3600_000 + 1;
      expect((await call(post('/v1/feedback', feedback({ installId: id(11) })))).status).toBe(202);
    });

    it('a refused feedback writes nothing', async () => {
      for (let i = 0; i < 5; i++) await call(post('/v1/feedback', feedback(), { 'cf-connecting-ip': `198.51.100.${i}` }));
      const addHit = vi.spyOn(store, 'addHit');
      const add = vi.spyOn(store, 'addFeedback');
      expect((await call(post('/v1/feedback', feedback(), { 'cf-connecting-ip': '198.51.100.9' }))).status).toBe(429);
      expect(addHit).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
      expect(mailer.sent).toHaveLength(5);
    });

    it('never puts the person\'s address into the subject', async () => {
      await call(post('/v1/feedback', feedback({ text: 'Hi', email: 'secret.person@example.com' })));
      expect(mailer.sent[0]!.subject).not.toContain('secret.person');
    });

    it('never stores the IP itself', async () => {
      await call(post('/v1/feedback', feedback()));
      expect(JSON.stringify(store)).not.toContain('203.0.113.7');
    });

    it.each([
      ['text over 5 000 characters', { text: 'a'.repeat(5001) }],
      ['an empty text', { text: '   ' }],
      ['an unknown kind', { kind: 'other' }],
      ['an unknown language', { language: 'fr' }],
      ['a bad email', { email: 'not an address' }],
      ['an email over 254 characters', { email: `${'a'.repeat(250)}@x.de` }],
      ['an extra field', { profile: { name: 'Max' } }],
      ['a bad version', { version: 'v0.11.0' }],
    ])('refuses %s with 400', async (_, over) => {
      expect((await call(post('/v1/feedback', feedback(over)))).status).toBe(400);
      expect(mailer.sent).toHaveLength(0);
    });

    it('accepts exactly 5 000 characters (counted as characters, not UTF-16 units)', async () => {
      expect((await call(post('/v1/feedback', feedback({ text: '😀'.repeat(5000) })))).status).toBe(202);
    });

    it('sends no CORS header (only the app server calls the worker)', async () => {
      const res = await call(post('/v1/feedback', feedback(), { origin: 'https://evil.example' }));
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});

describe.each([
  ['MemoryStore', () => new MemoryStore()],
  ['D1Store (real SQL)', () => new D1Store(sqliteD1())],
])('%s', (_, make: () => Store) => {
  let store: Store;
  beforeEach(() => { store = make(); });

  const day = (t: number) => new Date(t).toISOString().slice(0, 10);

  it('keeps one row per install with its last version and day', async () => {
    await store.recordPing(A, '0.10.1', day(T0 - 40 * DAY));
    await store.recordPing(A, '0.11.0', day(T0));
    await store.recordPing(B, '0.11.0', day(T0 - 3 * DAY));
    const s = await store.stats(T0);
    expect(s.users).toEqual({ d1: 1, d7: 2, d30: 2 });
    expect(s.versions).toEqual([{ version: '0.11.0', users: 2 }]);
  });

  it('counts hits inside the window only; counting writes nothing', async () => {
    expect(await store.countHits('k', 3600_000, T0)).toBe(0);
    await store.addHit('k', T0);
    await store.addHit('k', T0 + 1000);
    expect(await store.countHits('k', 3600_000, T0 + 1000)).toBe(2);
    expect(await store.countHits('k', 3600_000, T0 + 3600_000 + 500)).toBe(1);
    expect(await store.countHits('other', 3600_000, T0)).toBe(0);
  });

  it('knows the last ping day of an install', async () => {
    expect(await store.lastPingDay(A)).toBeNull();
    await store.recordPing(A, '0.11.0', day(T0));
    expect(await store.lastPingDay(A)).toBe(day(T0));
  });

  it('keeps one admin code: a new one replaces the old, attempts count, delete removes it', async () => {
    expect(await store.getCode()).toBeNull();
    await store.saveCode('h1', T0 + 1000);
    await store.saveCode('h2', T0 + 2000);
    expect(await store.takeCodeAttempt(T0, 5)).toBe('h2');
    expect(await store.takeCodeAttempt(T0, 5)).toBe('h2');
    expect(await store.getCode()).toEqual({ hash: 'h2', expires: T0 + 2000, attempts: 2 });
    await store.deleteCode();
    expect(await store.getCode()).toBeNull();
  });

  it('gives out code attempts only up to the limit and before expiry, also in parallel', async () => {
    expect(await store.takeCodeAttempt(T0, 5)).toBeNull();
    await store.saveCode('h', T0 + 1000);
    const taken = await Promise.all(Array.from({ length: 12 }, () => store.takeCodeAttempt(T0, 5)));
    expect(taken.filter((h) => h === 'h')).toHaveLength(5);
    expect((await store.getCode())!.attempts).toBe(5);
    await store.saveCode('h2', T0 + 1000);
    expect(await store.takeCodeAttempt(T0 + 1000, 5)).toBeNull();
  });

  it('lets only one caller consume a code', async () => {
    await store.saveCode('h', T0 + 1000);
    expect(await store.consumeCode('other')).toBe(false);
    const results = await Promise.all([store.consumeCode('h'), store.consumeCode('h'), store.consumeCode('h')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.getCode()).toBeNull();
  });

  it('takes a hit only while under the limit, also in parallel, and gives one back', async () => {
    const taken = await Promise.all(Array.from({ length: 8 }, () => store.takeHit('k', 3600_000, T0, 3)));
    expect(taken.filter(Boolean)).toHaveLength(3);
    expect(await store.countHits('k', 3600_000, T0)).toBe(3);
    await store.releaseHit('k', T0);
    expect(await store.countHits('k', 3600_000, T0)).toBe(2);
    expect(await store.takeHit('k', 3600_000, T0, 3)).toBe(true);
    expect(await store.takeHit('k', 3600_000, T0 + 3600_000, 3)).toBe(true);
  });

  it('keeps sessions until they expire or are deleted', async () => {
    await store.addSession('s1', T0 + 1000);
    await store.addSession('s2', T0 + 1000);
    expect(await store.hasSession('s1', T0)).toBe(true);
    expect(await store.hasSession('s1', T0 + 1000)).toBe(false);
    expect(await store.hasSession('nope', T0)).toBe(false);
    await store.deleteSession('s2');
    expect(await store.hasSession('s2', T0)).toBe(false);
  });

  it('lists feedback newest first and records whether it was mailed', async () => {
    const base = { version: '0.11.0', language: 'de', kind: 'idea' as const, email: 'a@b.de', text: 't' };
    const first = await store.addFeedback({ ...base, createdAt: new Date(T0).toISOString() });
    const second = await store.addFeedback({ ...base, createdAt: new Date(T0 + 1000).toISOString(), text: 'second' });
    await store.markMailed(second, true);
    const list = await store.listFeedback(10);
    expect(list.map((f) => f.id)).toEqual([second, first]);
    expect(list.map((f) => f.mailed)).toEqual([true, false]);
    expect(await store.listFeedback(1)).toHaveLength(1);
  });

  it('purges feedback after 12 months, hits after 2 hours and pings after 400 days', async () => {
    const base = { version: '0.11.0', language: 'de', kind: 'problem' as const, email: 'a@b.de', text: 't' };
    await store.addFeedback({ ...base, createdAt: new Date(T0 - 366 * DAY).toISOString(), text: 'old' });
    await store.addFeedback({ ...base, createdAt: new Date(T0 - 300 * DAY).toISOString(), text: 'kept' });
    await store.addHit('ip:old', T0 - 3 * 3600_000);
    await store.addHit('ip:new', T0 - 3600_000);
    await store.addSession('expired', T0 - 1);
    await store.addSession('live', T0 + 1000);
    await store.saveCode('old-code', T0 - 1);
    await store.recordPing(A, '0.9.0', day(T0 - 401 * DAY));
    await store.recordPing(B, '0.11.0', day(T0 - 10 * DAY));
    await store.purge(T0);
    expect((await store.listFeedback(10)).map((f) => f.text)).toEqual(['kept']);
    expect(await store.countHits('ip:old', 24 * 3600_000, T0)).toBe(0);
    expect(await store.countHits('ip:new', 24 * 3600_000, T0)).toBe(1);
    expect(await store.hasSession('live', T0)).toBe(true);
    expect(await store.getCode()).toBeNull();
    expect((await store.stats(T0)).users.d30).toBe(1);
    await store.recordPing(A, '0.9.0', day(T0 - 401 * DAY));
    await store.purge(T0);
    expect((await store.stats(T0)).versions).toEqual([{ version: '0.11.0', users: 1 }]);
  });
});
