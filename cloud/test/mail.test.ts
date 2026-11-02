import { describe, it, expect } from 'vitest';
import { FROM, RESEND_URL, ResendMailer } from '../src/mail.js';

type Call = { url: string; init: RequestInit };

function fakeFetch(answer: () => Promise<Response>): { fn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return { fn, calls };
}

describe('ResendMailer', () => {
  it('posts the mail to Resend with the key, to Robert, with reply_to as its own field', async () => {
    const f = fakeFetch(async () => new Response('{"id":"x"}', { status: 200 }));
    const ok = await new ResendMailer('re_key', 'robert@example.com', f.fn)
      .send({ subject: 'BewerbungsPilot 0.11.0: Idea — x', text: 'body', replyTo: 'max@example.com' });
    expect(ok).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe(RESEND_URL);
    expect(f.calls[0]!.init.method).toBe('POST');
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({
      from: FROM, to: ['robert@example.com'], subject: 'BewerbungsPilot 0.11.0: Idea — x', text: 'body', reply_to: 'max@example.com',
    });
    expect(f.calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('leaves reply_to out when there is none', async () => {
    const f = fakeFetch(async () => new Response('{}', { status: 200 }));
    await new ResendMailer('k', 'r@example.com', f.fn).send({ subject: 's', text: 't' });
    expect(JSON.parse(f.calls[0]!.init.body as string)).not.toHaveProperty('reply_to');
  });

  it('answers false (never throws) on non-2xx, network errors and timeouts', async () => {
    for (const answer of [
      async () => new Response('{"message":"bad"}', { status: 422 }),
      async () => new Response('', { status: 500 }),
      async () => { throw new TypeError('fetch failed'); },
      async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
    ]) {
      expect(await new ResendMailer('k', 'r@example.com', fakeFetch(answer).fn).send({ subject: 's', text: 't' })).toBe(false);
    }
  });

  it('sends nothing without a key or an address', async () => {
    const f = fakeFetch(async () => new Response('{}', { status: 200 }));
    expect(await new ResendMailer('', 'r@example.com', f.fn).send({ subject: 's', text: 't' })).toBe(false);
    expect(await new ResendMailer('k', '', f.fn).send({ subject: 's', text: 't' })).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
});
