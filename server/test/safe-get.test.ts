import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkPublicUrl, isPublicAddress } from '../src/vacancies/sources/safe-address.js';
import { safeGetBytes, SafeGetError } from '../src/vacancies/sources/safe-get.js';

// Same harness as pdf-fetch.test.ts: `a.test` and `b.test` resolve to the local server and count as public.
const HOSTS = ['a.test', 'b.test'];
const check = (url: string) => (HOSTS.includes(new URL(url).hostname) ? Promise.resolve({ ok: true as const }) : checkPublicUrl(url));
const isPublic = (ip: string) => ip === '127.0.0.1' || isPublicAddress(ip);
const lookup = async (host: string) => (HOSTS.includes(host) ? ['127.0.0.1'] : []);

let server: http.Server;
const port = () => (server.address() as AddressInfo).port;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const p = new URL(req.url ?? '/', 'http://x').pathname;
    if (p === '/ok') { res.end('hello'); return; }
    if (p === '/big') { res.end(Buffer.alloc(2048, 0x41)); return; }
    if (p === '/slow') { res.writeHead(200); res.write('x'); return; } // never ends
    if (p === '/same-host') { res.writeHead(302, { location: '/ok' }); res.end(); return; }
    if (p === '/other-host') { res.writeHead(302, { location: `http://b.test:${port()}/ok` }); res.end(); return; }
    if (p === '/to-metadata') { res.writeHead(302, { location: 'http://169.254.169.254/latest' }); res.end(); return; }
    res.writeHead(500); res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const url = (path: string, host = 'a.test') => `http://${host}:${port()}${path}`;
const get = (u: string, extra: { maxBytes?: number; timeoutMs?: number; allowHosts?: string[]; signal?: AbortSignal } = {}) =>
  safeGetBytes(u, { maxBytes: 1024, timeoutMs: 2000, signal: new AbortController().signal, check, lookup, isPublic, ...extra });
const why = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof SafeGetError ? e.why : `other: ${String(e)}`));

describe('safeGetBytes', () => {
  it('returns the body and follows a redirect on the same host', async () => {
    expect(new TextDecoder().decode(await get(url('/same-host'), { allowHosts: ['a.test'] }))).toBe('hello');
  });

  it('a redirect to another host is refused when the hosts are limited, followed otherwise', async () => {
    expect(await why(get(url('/other-host'), { allowHosts: ['a.test'] }))).toBe('blocked');
    expect(await why(get(url('/ok', 'b.test'), { allowHosts: ['a.test'] }))).toBe('blocked');
    expect(await why(get(url('/other-host')))).toBe('ok');
  });

  it('a redirect to an internal address is blocked; a non-2xx status is "status"', async () => {
    expect(await why(get(url('/to-metadata')))).toBe('blocked');
    expect(await why(get(url('/nope')))).toBe('status');
  });

  it('more than maxBytes is "tooBig", the time limit is "timeout"', async () => {
    expect(await why(get(url('/big')))).toBe('tooBig');
    expect(await why(get(url('/slow'), { timeoutMs: 200 }))).toBe('timeout');
  });

  it('an abort by the caller ends it at once (not as a timeout)', async () => {
    const ctl = new AbortController();
    const pending = why(get(url('/slow'), { signal: ctl.signal, timeoutMs: 10_000 }));
    setTimeout(() => ctl.abort(), 50);
    expect(await pending).toBe('network');
  });
});
