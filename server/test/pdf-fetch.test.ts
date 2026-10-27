import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HttpPdfFetcher, MAX_PDF_BYTES } from '../src/vacancies/sources/pdf-fetch.js';
import { checkPublicUrl, isPublicAddress } from '../src/vacancies/sources/safe-address.js';

const fixture = (name: string) => fs.readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
const TEXT_PDF = fixture('cv-text.pdf');
const SCAN_PDF = fixture('cv-scan.pdf');

// The test server runs on 127.0.0.1; only the name `pdf.test` (resolved to it) counts as public, everything else
// goes through the real rules — so a redirect to 169.254.169.254 or a name resolving to 10.0.0.1 is still refused.
const TEST_HOST = 'pdf.test';
const check = (url: string) => (new URL(url).hostname === TEST_HOST ? Promise.resolve({ ok: true as const }) : checkPublicUrl(url));
const isPublic = (ip: string) => ip === '127.0.0.1' || isPublicAddress(ip);
const lookup = async (host: string) => (host === TEST_HOST ? ['127.0.0.1'] : host === 'evil.test' ? ['10.0.0.1'] : []);

let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    if (p === '/cv.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(TEXT_PDF); return; }
    if (p === '/scan.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(SCAN_PDF); return; }
    if (p === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>Job</body></html>'); return; }
    if (p === '/huge.pdf') {
      // Says 1 KB, sends 11 MB: the size is counted, not taken from the header.
      res.writeHead(200, { 'content-type': 'application/pdf' });
      const chunk = Buffer.alloc(1024 * 1024, 0x20);
      res.write('%PDF-1.4\n');
      let sent = 0;
      const pump = () => { while (sent < 11) { sent++; if (!res.write(chunk)) { res.once('drain', pump); return; } } res.end(); };
      pump();
      return;
    }
    if (p === '/slow.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); res.write('%PDF-1.4\n'); return; } // never ends
    if (p === '/missing.pdf') { res.writeHead(404); res.end(); return; }
    if (p === '/to-metadata') { res.writeHead(302, { location: 'http://169.254.169.254/latest' }); res.end(); return; }
    if (p === '/to-evil') { res.writeHead(302, { location: `http://evil.test:${port()}/cv.pdf` }); res.end(); return; }
    const hops = /^\/hop\/(\d+)$/.exec(p);
    if (hops) {
      const left = Number(hops[1]);
      res.writeHead(302, { location: left > 1 ? `/hop/${left - 1}` : '/cv.pdf' });
      res.end();
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://${TEST_HOST}:${port()}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function port(): number { return (server.address() as AddressInfo).port; }

function fetcher(extra: { timeoutMs?: number; log?: (e: string, d: { host: string; result: string }) => void } = {}) {
  return new HttpPdfFetcher({ check, lookup, isPublic, ...extra });
}
const signal = () => new AbortController().signal;

describe('HttpPdfFetcher', () => {
  it('reads the text of a PDF and logs only the host and the result', async () => {
    const log = vi.fn();
    const r = await fetcher({ log }).fetch(`${base}/cv.pdf?token=secret`, signal());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text.length).toBeGreaterThan(200);
    expect(r.host).toBe(TEST_HOST);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('vacancy.pdfRead', { host: TEST_HOST, result: 'ok' });
  });

  it('refuses an HTML page as not-pdf', async () => {
    expect(await fetcher().fetch(`${base}/page.html`, signal())).toEqual({ ok: false, host: TEST_HOST, why: 'not-pdf' });
  });

  it('stops at 10 MB even when Content-Length is missing or lies', async () => {
    expect(MAX_PDF_BYTES).toBe(10 * 1024 * 1024);
    expect(await fetcher().fetch(`${base}/huge.pdf`, signal())).toEqual({ ok: false, host: TEST_HOST, why: 'too-large' });
  });

  it('gives up after the time limit on a body that never ends', async () => {
    const started = Date.now();
    expect(await fetcher({ timeoutMs: 500 }).fetch(`${base}/slow.pdf`, signal())).toEqual({ ok: false, host: TEST_HOST, why: 'failed' });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('answers failed for a non-2xx status', async () => {
    expect(await fetcher().fetch(`${base}/missing.pdf`, signal())).toEqual({ ok: false, host: TEST_HOST, why: 'failed' });
  });

  it('blocks a redirect to an internal address', async () => {
    expect(await fetcher().fetch(`${base}/to-metadata`, signal())).toEqual({ ok: false, host: TEST_HOST, why: 'blocked' });
  });

  it('blocks a name that resolves to a private address at connect time (no second lookup can slip through)', async () => {
    // The URL check is told the name is fine (as a rebinding DNS would answer first); the pinned connect lookup refuses.
    const f = new HttpPdfFetcher({ check: async () => ({ ok: true }), lookup, isPublic });
    expect(await f.fetch(`http://evil.test:${port()}/cv.pdf`, signal())).toEqual({ ok: false, host: 'evil.test', why: 'blocked' });
  });

  it('blocks a redirect to a name that resolves to a private address', async () => {
    const f = new HttpPdfFetcher({ check: async () => ({ ok: true }), lookup, isPublic });
    expect(await f.fetch(`${base}/to-evil`, signal())).toEqual({ ok: false, host: TEST_HOST, why: 'blocked' });
  });

  it('follows up to 5 redirects and refuses the 6th', async () => {
    expect((await fetcher().fetch(`${base}/hop/5`, signal())).ok).toBe(true);
    expect(await fetcher().fetch(`${base}/hop/6`, signal())).toEqual({ ok: false, host: TEST_HOST, why: 'failed' });
  });

  it('treats a PDF without text (scan) as no-text', async () => {
    expect(await fetcher().fetch(`${base}/scan.pdf`, signal())).toEqual({ ok: false, host: TEST_HOST, why: 'no-text' });
  });

  it('throws LLM_CANCELLED when the person stops it', async () => {
    const ctrl = new AbortController();
    const run = fetcher().fetch(`${base}/slow.pdf`, ctrl.signal);
    setTimeout(() => ctrl.abort(), 100);
    await expect(run).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
    const already = new AbortController();
    already.abort();
    await expect(fetcher().fetch(`${base}/cv.pdf`, already.signal)).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
  });

  it('refuses a link the URL check refuses, without connecting', async () => {
    const f = new HttpPdfFetcher({ lookup, isPublic });
    expect(await f.fetch(`http://127.0.0.1:${port()}/cv.pdf`, signal())).toEqual({ ok: false, host: '127.0.0.1', why: 'blocked' });
  });

  it('downloads one PDF at a time', async () => {
    const f = fetcher({ timeoutMs: 300 });
    const order: string[] = [];
    const a = f.fetch(`${base}/slow.pdf`, signal()).then(() => order.push('slow'));
    const b = f.fetch(`${base}/cv.pdf`, signal()).then(() => order.push('cv'));
    await Promise.all([a, b]);
    expect(order).toEqual(['slow', 'cv']);
  });
});
