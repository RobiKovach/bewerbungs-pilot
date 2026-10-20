import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
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
