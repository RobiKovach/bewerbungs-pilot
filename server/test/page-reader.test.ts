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

/**
 * A browser for sessions: every URL in `pages` is a page; `ip` is where the page "answered" from. Options: a popup
 * created while `newPage` runs, a slow start, a `goto` that never ends.
 */
function sessionLaunch(
  pages: Record<string, { text: string; links?: unknown; ip?: string }>,
  opts: { popupDuringNewPage?: boolean; launchDelayMs?: number; hangGoto?: boolean } = {},
) {
  const profiles: string[] = [];
  const launchesSettled: number[] = [];
  const launchesStarted: number[] = [];
  const tabs: { own: boolean; closed: boolean }[] = [];
  let closes = 0;
  const launch = async (o: { userDataDir: string }) => {
    profiles.push(o.userDataDir);
    launchesStarted.push(Date.now());
    if (opts.launchDelayMs) await new Promise((r) => setTimeout(r, opts.launchDelayMs));
    launchesSettled.push(Date.now());
    const listeners: ((t: unknown) => void)[] = [];
    const target = (tab: { own: boolean; closed: boolean }, opener?: object) => ({
      type: () => 'page', opener: () => opener, page: async () => ({ close: async () => { tab.closed = true; } }),
    });
    const browser = {
      target: () => ({ createCDPSession: async () => ({ send: async () => ({}) }) }),
      newPage: async () => {
        const tab = { own: true, closed: false };
        tabs.push(tab);
        const own = target(tab);
        if (opts.popupDuringNewPage) {
          // An earlier page's popup without opener info arrives while our tab is being made, before our own target.
          const popup = { own: false, closed: false };
          tabs.push(popup);
          for (const l of listeners) l(target(popup));
        }
        for (const l of listeners) l(own);
        let current = '';
        const handlers: Record<string, (x: unknown) => void> = {};
        return {
          target: () => own, setBypassServiceWorker: async () => {}, evaluateOnNewDocument: async () => {}, setRequestInterception: async () => {},
          on: (event: string, fn: (x: unknown) => void) => { handlers[event] = fn; },
          goto: async (url: string) => {
            current = url;
            if (opts.hangGoto) return new Promise(() => {});
            const p = pages[url];
            if (!p) throw new Error('net::ERR_NAME_NOT_RESOLVED');
            handlers.response?.({ remoteAddress: () => ({ ip: p.ip ?? '93.184.216.34' }) });
            return okResponse;
          },
          waitForNetworkIdle: async () => {}, url: () => current, close: async () => { tab.closed = true; },
          evaluate: async (expr: string) => (expr.includes('a[href]') ? (pages[current]!.links ?? []) : pages[current]!.text),
        };
      },
      on: (event: string, fn: (t: unknown) => void) => { if (event === 'targetcreated') listeners.push(fn); },
      close: async () => { closes++; }, process: () => null,
    };
    return browser as unknown as import('puppeteer-core').Browser;
  };
  return { launch: vi.fn(launch), profiles, tabs, launchesStarted, launchesSettled, closes: () => closes };
}

describe('BrowserPageReader sessions (0.13.0)', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bp session-'));
  const make = (pages: Parameters<typeof sessionLaunch>[0], check: Check = publicCheck, opts: Parameters<typeof sessionLaunch>[1] = {}, timeoutMs?: number) => {
    const fake = sessionLaunch(pages, opts);
    const log = vi.fn();
    return { fake, log, r: new BrowserPageReader({ tmpRoot, find: () => 'C:/edge.exe', check, log, launch: fake.launch, ...(timeoutMs ? { timeoutMs } : {}) }) };
  };
  const A = 'https://jobs.example.de/1';
  const B = 'https://www.firma.de/impressum';

  it('session reads two pages with one browser and deletes the profile once on close', async () => {
    const { fake, r, log } = make({ [A]: { text: 'Stelle' }, [B]: { text: 'Impressum Firma GmbH' } });
    const s = await r.session(new AbortController().signal, Date.now() + 5000);
    expect((await s.open(A)).text).toBe('Stelle');
    const b = await s.open(B);
    expect(b).toMatchObject({ url: B, text: 'Impressum Firma GmbH', links: [] });
    expect(fake.launch).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(fake.profiles[0]!)).toBe(true);
    await s.close();
    await s.close();
    expect(fs.existsSync(fake.profiles[0]!)).toBe(false);
    expect(fake.closes()).toBe(1);
    expect(log.mock.calls).toEqual([
      ['vacancy.pageRead', { host: 'jobs.example.de', result: 'ok' }],
      ['vacancy.pageRead', { host: 'www.firma.de', result: 'ok' }],
    ]);
  });

  it('links include mailto and tel, are absolute, capped at 300', async () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ text: `Job ${i}`, href: `https://jobs.example.de/job/${i}` }));
    const links = [
      { text: 'Jetzt   bewerben', href: 'mailto:jobs@firma.de?subject=Bewerbung' },
      { text: 'Anrufen', href: 'tel:+493517990350' },
      { text: 'Impressum', href: '/impressum' },
      { text: 'Boese', href: 'javascript:alert(1)' },
      { text: 'x'.repeat(200), href: 'https://www.firma.de/' },
      'not a link', { href: 42 },
      ...many,
    ];
    const { r } = make({ [A]: { text: 'Stelle', links } });
    const s = await r.session(new AbortController().signal, Date.now() + 5000);
    const read = await s.open(A);
    await s.close();
    expect(read.links).toHaveLength(300);
    expect(read.links.slice(0, 4)).toEqual([
      { text: 'Jetzt bewerben', href: 'mailto:jobs@firma.de?subject=Bewerbung' },
      { text: 'Anrufen', href: 'tel:+493517990350' },
      { text: 'Impressum', href: 'https://jobs.example.de/impressum' },
      { text: 'x'.repeat(80), href: 'https://www.firma.de/' },
    ]);
    expect(read.links.some((l) => /^(?:javascript|data|vbscript):/i.test(l.href))).toBe(false);
  });

  it('a page answered from an internal address throws blocked and the session stays usable', async () => {
    const { r, log } = make({ [A]: { text: 'Intern', ip: '10.0.0.5' }, [B]: { text: 'Impressum' } });
    const s = await r.session(new AbortController().signal, Date.now() + 5000);
    await expect(s.open(A)).rejects.toMatchObject({ reason: 'pageUnreadable', detailsForLog: 'page not readable: blocked: answered from an internal address' });
    expect((await s.open(B)).text).toBe('Impressum');
    await s.close();
    expect(log.mock.calls[0]).toEqual(['vacancy.pageRead', { host: 'jobs.example.de', result: 'blocked' }]);
  });

  it('open after the deadline throws pageUnreadable timeout', async () => {
    const { r, fake } = make({ [A]: { text: 'Stelle' } });
    const s = await r.session(new AbortController().signal, Date.now() - 1);
    await expect(s.open(A)).rejects.toMatchObject({ reason: 'pageUnreadable', detailsForLog: 'page not readable: timeout' });
    await s.close();
    expect(fake.launch).not.toHaveBeenCalled();
  });

  it('a plain read waits until an open interactive session (Find contact) is closed', async () => {
    const { r } = make({ [A]: { text: 'Stelle '.repeat(10) }, [B]: { text: 'Impressum' } });
    const s = await r.session(new AbortController().signal, Date.now() + 5000, 'interactive');
    let readDone = false;
    const read = r.read(B, new AbortController().signal).then((t) => { readDone = true; return t; });
    await s.open(A);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readDone).toBe(false);
    await s.close();
    expect(await read).toBe('Impressum');
  });

  it('a blocked first address never starts the browser; Stop ends the session', async () => {
    const { r, fake } = make({ [A]: { text: 'Stelle' } }, privateCheck);
    const ctrl = new AbortController();
    const s = await r.session(ctrl.signal, Date.now() + 5000);
    await expect(s.open('http://192.168.1.1/')).rejects.toMatchObject({ detailsForLog: 'page not readable: blocked address' });
    expect(fake.launch).not.toHaveBeenCalled();
    ctrl.abort();
    await expect(s.open(A)).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
    await s.close();
  });

  it('a popup created while our tab is made is closed; our tab is kept until the page is read', async () => {
    const { r, fake } = make({ [A]: { text: 'Stelle' } }, publicCheck, { popupDuringNewPage: true });
    const s = await r.session(new AbortController().signal, Date.now() + 5000);
    expect((await s.open(A)).text).toBe('Stelle');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const popup = fake.tabs.find((t) => !t.own)!;
    const own = fake.tabs.find((t) => t.own)!;
    expect(popup.closed).toBe(true);
    expect(own.closed).toBe(true); // closed after the read, before the next open
    await s.close();
  });

  it('a page stopped mid-load by the time limit is closed', async () => {
    const { r, fake } = make({ [A]: { text: 'Stelle' } }, publicCheck, { hangGoto: true });
    const s = await r.session(new AbortController().signal, Date.now() + 150);
    await expect(s.open(A)).rejects.toMatchObject({ detailsForLog: 'page not readable: timeout' });
    expect(fake.tabs[0]!.closed).toBe(true);
    await s.close();
  });

  it('a read queued behind an interactive session held longer than its own limit still gets its full time', async () => {
    const { r } = make({ [A]: { text: 'Stelle '.repeat(10) }, [B]: { text: 'Impressum' } }, publicCheck, {}, 200);
    const s = await r.session(new AbortController().signal, Date.now() + 5000, 'interactive');
    const read = r.read(B, new AbortController().signal);
    await s.open(A);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await s.close();
    expect(await read).toBe('Impressum');
  });

  it('a browser still starting after the deadline is waited for: profile gone, next session starts after it', async () => {
    const { r, fake } = make({ [A]: { text: 'Stelle' }, [B]: { text: 'Impressum' } }, publicCheck, { launchDelayMs: 200 });
    const s = await r.session(new AbortController().signal, Date.now() + 50);
    await expect(s.open(A)).rejects.toMatchObject({ detailsForLog: 'page not readable: timeout' });
    const read = r.session(new AbortController().signal, Date.now() + 5000).then(async (next) => {
      try { return (await next.open(B)).text; } finally { await next.close(); }
    });
    await s.close();
    expect(fake.launchesSettled).toHaveLength(1);
    expect(fake.closes()).toBe(1);
    expect(fs.existsSync(fake.profiles[0]!)).toBe(false);
    expect(await read).toBe('Impressum');
    expect(fake.launchesStarted[1]!).toBeGreaterThanOrEqual(fake.launchesSettled[0]!);
  });

  it('a background research session never holds up a pasted link or Find contact (final review I2)', async () => {
    const { r } = make({ [A]: { text: 'Stelle '.repeat(10) }, [B]: { text: 'Impressum '.repeat(10) } });
    const research = await r.session(new AbortController().signal, Date.now() + 5000);
    await research.open(A);
    // The research keeps its browser; an interactive read and an interactive session go ahead without waiting.
    expect(await r.read(B, new AbortController().signal)).toContain('Impressum');
    const find = await r.session(new AbortController().signal, Date.now() + 5000, 'interactive');
    expect((await find.open(B)).text).toContain('Impressum');
    await find.close();
    await research.close();
  });
});
