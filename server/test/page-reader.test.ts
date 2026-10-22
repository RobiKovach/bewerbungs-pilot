import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import puppeteer from 'puppeteer-core';
import { findBrowser } from '../src/applications/pdf.js';
import { allowRequest, BrowserPageReader, launchOptions, LOCKDOWN_SCRIPT, pageText } from '../src/vacancies/sources/page-reader.js';
import type { checkPublicUrl } from '../src/vacancies/sources/safe-address.js';

type Check = typeof checkPublicUrl;
const publicCheck: Check = async () => ({ ok: true });
const privateCheck: Check = async () => ({ ok: false, why: 'private' });

describe('allowRequest', () => {
  it.each(['image', 'media', 'font'])('blocks %s without asking where it points', async (type) => {
    const check = vi.fn(publicCheck);
    expect(await allowRequest('https://jobs.example.de/logo.png', type, check)).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('blocks anything whose address check fails (private, scheme, port …)', async () => {
    expect(await allowRequest('http://192.168.1.1/', 'document', privateCheck)).toBe(false);
    expect(await allowRequest('https://jobs.example.de/app.js', 'script', privateCheck)).toBe(false);
  });

  it.each(['document', 'script', 'xhr', 'fetch', 'stylesheet'])('allows a public %s', async (type) => {
    expect(await allowRequest('https://jobs.example.de/x', type, publicCheck)).toBe(true);
  });

  it('allows inline data: (no network) but never as a page', async () => {
    const check = vi.fn(privateCheck);
    expect(await allowRequest('data:text/css,body{}', 'stylesheet', check)).toBe(true);
    expect(await allowRequest('data:text/html,<p>x</p>', 'document', check)).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });
});

describe('pageText', () => {
  it('trims and cuts the text to the limit', () => {
    expect(pageText('  Hallo Welt  ', 100)).toBe('Hallo Welt');
    expect(pageText('a'.repeat(70_000), 60_000)).toHaveLength(60_000);
  });

  it('squeezes runs of blank lines', () => {
    expect(pageText('Titel\n\n\n\n\nText', 100)).toBe('Titel\n\nText');
  });
});

describe('BrowserPageReader', () => {
  it('no Edge or Chrome → BROWSER_MISSING, and the address is not even checked', async () => {
    const check = vi.fn(publicCheck);
    const reader = new BrowserPageReader({ tmpRoot: '.', find: () => null, check });
    await expect(reader.read('https://jobs.example.de/1', new AbortController().signal)).rejects.toMatchObject({ code: 'BROWSER_MISSING' });
    expect(check).not.toHaveBeenCalled();
  });

  it('a blocked address → pageUnreadable before any browser starts', async () => {
    const find = vi.fn(() => 'C:/nowhere/msedge.exe');
    const log = vi.fn();
    const reader = new BrowserPageReader({ tmpRoot: '.', find, check: privateCheck, log });
    await expect(reader.read('http://192.168.1.1/admin?token=secret', new AbortController().signal))
      .rejects.toMatchObject({ code: 'BAD_REQUEST', reason: 'pageUnreadable' });
    expect(log).toHaveBeenCalledWith('vacancy.pageRead', { host: '192.168.1.1', result: 'blocked' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });
});

describe('lockdown (popups, workers, sockets go around the request filter)', () => {
  it('keeps the popup blocker on: puppeteer --disable-popup-blocking default is dropped', () => {
    const o = launchOptions('C:/edge.exe', 'C:/tmp/p', 25_000);
    expect(o.ignoreDefaultArgs).toContain('--disable-popup-blocking');
    expect(o.args).toContain('--block-new-web-contents');
  });

  it('the page gets no window.open, workers, service workers, WebSocket, WebTransport or WebRTC', async () => {
    class SwContainer { register() { return Promise.resolve('registered'); } }
    const win: Record<string, unknown> = {
      open: () => 'opened', Worker: class {}, SharedWorker: class {}, WebSocket: class {}, WebTransport: class {},
      RTCPeerConnection: class {}, webkitRTCPeerConnection: class {}, fetch: () => 'kept',
    };
    const ctx = vm.createContext({ window: win, navigator: { serviceWorker: new SwContainer() }, Object, Promise, Error });
    vm.runInContext(LOCKDOWN_SCRIPT, ctx);
    expect((win.open as () => unknown)()).toBeNull();
    for (const name of ['Worker', 'SharedWorker', 'WebSocket', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection']) expect(win[name]).toBeUndefined();
    expect(() => { win.WebSocket = class {}; }).toThrow(TypeError);
    expect(win.WebSocket).toBeUndefined();
    const sw = (ctx as { navigator: { serviceWorker: SwContainer } }).navigator.serviceWorker;
    await expect(sw.register()).rejects.toThrow('blocked');
    expect((win.fetch as () => unknown)()).toBe('kept');
  });
});

/** A browser that does just enough for BrowserPageReader; `goto` decides what the page does. */
function fakeLaunch(goto: (signal: { closed: Promise<void> }) => Promise<unknown>, innerText = '') {
  let close!: () => void;
  const closed = new Promise<void>((r) => { close = r; });
  const page = {
    target: () => ({}), setBypassServiceWorker: async () => {}, evaluateOnNewDocument: async () => {}, setRequestInterception: async () => {},
    on: () => {}, goto: () => goto({ closed }), waitForNetworkIdle: async () => {}, evaluate: async () => innerText,
  };
  const browser = {
    target: () => ({ createCDPSession: async () => ({ send: async () => ({}) }) }),
    newPage: async () => page, on: () => {}, close: async () => { close(); }, process: () => null,
  };
  return async () => browser as unknown as import('puppeteer-core').Browser;
}
const okResponse = { ok: () => true, status: () => 200 };

describe('BrowserPageReader with a fake browser', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bp reader-'));
  const reader = (launch: ReturnType<typeof fakeLaunch>, more: { timeoutMs?: number; minChars?: number; check?: Check } = {}) => {
    const log = vi.fn();
    return { log, r: new BrowserPageReader({ tmpRoot, find: () => 'C:/edge.exe', check: more.check ?? publicCheck, log, launch, timeoutMs: more.timeoutMs, minChars: more.minChars }) };
  };

  it('a too short page is refused and logged once as too-short', async () => {
    const { r, log } = reader(fakeLaunch(async () => okResponse, 'Cookies?'), { minChars: 200 });
    await expect(r.read('https://jobs.example.de/1', new AbortController().signal)).rejects.toMatchObject({ reason: 'pageUnreadable' });
    expect(log.mock.calls).toEqual([['vacancy.pageRead', { host: 'jobs.example.de', result: 'too-short' }]]);
  });

  it('a readable page is returned and logged once as ok', async () => {
    const { r, log } = reader(fakeLaunch(async () => okResponse, 'Wir suchen dich. '.repeat(20)), { minChars: 200 });
    expect(await r.read('https://jobs.example.de/1', new AbortController().signal)).toContain('Wir suchen dich.');
    expect(log.mock.calls).toEqual([['vacancy.pageRead', { host: 'jobs.example.de', result: 'ok' }]]);
  });

  it('a browser error keeps only its short net::ERR code, never the link', async () => {
    const { r, log } = reader(fakeLaunch(async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED at https://jobs.example.de/1?token=secret'); }));
    const err = await r.read('https://jobs.example.de/1?token=secret', new AbortController().signal).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'BAD_REQUEST', reason: 'pageUnreadable', detailsForLog: 'page not readable: net::ERR_NAME_NOT_RESOLVED' });
    expect(log.mock.calls).toEqual([['vacancy.pageRead', { host: 'jobs.example.de', result: 'failed' }]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });

  it('a page that never loads ends at the time limit', async () => {
    const { r } = reader(fakeLaunch(async ({ closed }) => { await closed; throw new Error('Target closed'); }), { timeoutMs: 100 });
    await expect(r.read('https://jobs.example.de/1', new AbortController().signal)).rejects.toMatchObject({ detailsForLog: 'page not readable: timeout' });
  });

  it('the time limit also covers a hanging address check', async () => {
    const launch = vi.fn(fakeLaunch(async () => okResponse));
    const { r, log } = reader(launch, { timeoutMs: 100, check: () => new Promise(() => {}) });
    await expect(r.read('https://jobs.example.de/1', new AbortController().signal)).rejects.toMatchObject({ detailsForLog: 'page not readable: timeout' });
    expect(launch).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([['vacancy.pageRead', { host: 'jobs.example.de', result: 'failed' }]]);
  });

  it('"Stop" during loading cancels the read', async () => {
    const ctrl = new AbortController();
    const { r } = reader(fakeLaunch(async ({ closed }) => { await closed; throw new Error('Target closed'); }));
    const p = r.read('https://jobs.example.de/1', ctrl.signal);
    setTimeout(() => ctrl.abort(), 30);
    await expect(p).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
  });
});

// Live, only where Edge or Chrome is installed (Windows CI has Edge): the lockdown also reaches iframes, including one
// created by script and read at once (spec 0.8.3, 6a — a frame realm must not hand out WebSocket or Worker).
describe.skipIf(!findBrowser())('lockdown in a real browser', () => {
  it('top page, about:blank, srcdoc and script-made iframes get no WebSocket, Worker or WebRTC', async () => {
    const html = `<!doctype html><body><iframe id="a" src="about:blank"></iframe><iframe id="s" srcdoc="<p>s</p>"></iframe><script>
      const kinds = ['WebSocket', 'Worker', 'SharedWorker', 'RTCPeerConnection', 'WebTransport'];
      const probe = (w) => kinds.filter((k) => typeof w[k] !== 'undefined');
      const d = document.createElement('iframe'); document.body.appendChild(d);
      const atOnce = probe(d.contentWindow);
      setTimeout(() => { window.__left = [probe(window), probe(document.getElementById('a').contentWindow), probe(document.getElementById('s').contentWindow), atOnce, probe(d.contentWindow)].flat(); }, 300);
    </script></body>`;
    const server = http.createServer((_q, res) => { res.setHeader('content-type', 'text/html'); res.end(html); }).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp lockdown-'));
    const browser = await puppeteer.launch(launchOptions(findBrowser()!, dir, 20_000));
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(LOCKDOWN_SCRIPT);
      await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
      await page.waitForFunction('Array.isArray(window.__left)', { timeout: 5000 });
      expect(await page.evaluate('window.__left')).toEqual([]);
    } finally {
      await browser.close();
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
