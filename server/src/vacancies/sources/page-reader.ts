import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { findBrowser, removeProfileDir } from '../../applications/pdf.js';
import { AppError } from '../../errors.js';
import { checkPublicUrl, isPublicAddress } from './safe-address.js';

export interface PageReader {
  /** The visible text of a pasted vacancy link (not Arbeitsagentur), or BROWSER_MISSING / BAD_REQUEST pageUnreadable. */
  read(url: string, signal: AbortSignal): Promise<string>;
}

type Check = typeof checkPublicUrl;
type Log = (event: string, data: { host: string; result: 'ok' | 'blocked' | 'failed' | 'too-short' }) => void;

const SKIPPED_TYPES = new Set(['image', 'media', 'font']);

/**
 * The request filter of the reading browser: pictures, video and fonts are never loaded; inline `data:` is fine
 * (no network) except as a whole page; everything else — the page itself, every redirect and every sub-request —
 * must pass the public-address check.
 */
export async function allowRequest(url: string, resourceType: string, check: Check): Promise<boolean> {
  if (SKIPPED_TYPES.has(resourceType)) return false;
  if (url.startsWith('data:')) return resourceType !== 'document';
  return (await check(url)).ok;
}

/** innerText, trimmed, with runs of blank lines squeezed and cut to `maxChars`. */
export function pageText(raw: string, maxChars: number): string {
  return raw.replace(/\r/g, '').replace(/\n[ \t]*(\n[ \t]*)+/g, '\n\n').trim().slice(0, maxChars);
}

/**
 * Runs in every frame before the page's own scripts. The request filter only sees requests of the page itself:
 * a popup's first navigation, workers, service workers, WebSockets, WebTransport and WebRTC would go around it,
 * so the page simply does not get them. Reading the visible text of a career page needs none of them.
 */
export const LOCKDOWN_SCRIPT = `(() => {
  const off = (obj, name, value) => { try { Object.defineProperty(obj, name, { value, writable: false, configurable: false }); } catch (e) {} };
  off(window, 'open', () => null);
  for (const name of ['Worker', 'SharedWorker', 'WebSocket', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection']) off(window, name, undefined);
  if (navigator.serviceWorker) off(Object.getPrototypeOf(navigator.serviceWorker), 'register', () => Promise.reject(new Error('blocked')));
})();`;

/** puppeteer adds --disable-popup-blocking by default; the reading browser keeps Chrome's popup blocker on. */
export function launchOptions(executablePath: string, userDataDir: string, timeoutMs: number) {
  return {
    executablePath, headless: true, userDataDir, timeout: timeoutMs,
    ignoreDefaultArgs: ['--disable-popup-blocking'],
    args: [
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking',
      '--block-new-web-contents', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ],
  };
}

const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return ''; } };
const unreadable = (why: string) => new AppError('BAD_REQUEST', `page not readable: ${why}`, 'pageUnreadable');

/**
 * Opens a pasted vacancy link in the installed Edge/Chrome (spec, section 6a): a fresh temporary profile (no cookies,
 * no accounts, deleted afterwards), JavaScript on (career pages are drawn by it), every request filtered by
 * `allowRequest`, downloads and new windows refused, one read at a time, 25 s in total (address check included). The
 * log gets only the host and the result, once per read — never the page text or the full link.
 */
export class BrowserPageReader implements PageReader {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly find: () => string | null;
  private readonly check: Check;
  private readonly timeoutMs: number;
  private readonly maxChars: number;

  constructor(private readonly opts: {
    tmpRoot: string; find?: () => string | null; check?: Check; timeoutMs?: number; maxChars?: number;
    /** Shorter page text is refused as unreadable (and logged as 'too-short'). */
    minChars?: number;
    /** Tests: a fake browser instead of puppeteer.launch. */
    launch?: (options: ReturnType<typeof launchOptions>) => Promise<Browser>;
    warn?: (event: string, data: Record<string, unknown>) => void; log?: Log;
  }) {
    this.find = opts.find ?? (() => findBrowser());
    this.check = opts.check ?? checkPublicUrl;
    this.timeoutMs = opts.timeoutMs ?? 25_000;
    this.maxChars = opts.maxChars ?? 60_000;
  }

  read(url: string, signal: AbortSignal): Promise<string> {
    const run = this.chain.then(() => this.readOnce(url, signal));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async readOnce(url: string, signal: AbortSignal): Promise<string> {
    const host = hostOf(url);
    const executablePath = this.find();
    if (!executablePath) throw new AppError('BROWSER_MISSING', 'no Edge or Chrome found');
    if (signal.aborted) throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
    // The whole read has one limit, starting before the address check (its DNS lookup can hang too).
    const deadline = Date.now() + this.timeoutMs;
    let checkTimer: NodeJS.Timeout | undefined;
    const checkTimeout = new Promise<'timeout'>((resolve) => { checkTimer = setTimeout(() => resolve('timeout'), this.timeoutMs); });
    const checked = await Promise.race([this.check(url), checkTimeout]).finally(() => clearTimeout(checkTimer));
    if (checked === 'timeout') {
      this.opts.log?.('vacancy.pageRead', { host, result: 'failed' });
      throw unreadable('timeout');
    }
    if (!checked.ok) {
      this.opts.log?.('vacancy.pageRead', { host, result: 'blocked' });
      throw unreadable('blocked address');
    }
    let text: string;
    try {
      text = await this.browse(executablePath, url, signal, Math.max(1, deadline - Date.now()));
    } catch (err) {
      // Only the browser's short error code goes on: its messages carry the full link (with its query string).
      const code = /net::ERR_[A-Z_]+/.exec(String(err))?.[0] ?? (err instanceof Error ? err.name : 'Error');
      const blocked = code === 'net::ERR_BLOCKED_BY_CLIENT' || (err instanceof AppError && err.detailsForLog.includes('blocked'));
      this.opts.log?.('vacancy.pageRead', { host, result: blocked ? 'blocked' : 'failed' });
      if (err instanceof AppError) throw err;
      if (signal.aborted) throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
      throw unreadable(code);
    }
    if (text.length < (this.opts.minChars ?? 0)) {
      this.opts.log?.('vacancy.pageRead', { host, result: 'too-short' });
      throw unreadable('too short');
    }
    this.opts.log?.('vacancy.pageRead', { host, result: 'ok' });
    return text;
  }

  private async browse(executablePath: string, url: string, signal: AbortSignal, timeoutMs: number): Promise<string> {
    fs.mkdirSync(this.opts.tmpRoot, { recursive: true });
    // `pdf-` prefix on purpose: BrowserPrinter's sweep removes such folders left behind by a crash.
    const profile = fs.mkdtempSync(path.join(this.opts.tmpRoot, 'pdf-read-'));
    let browser: Browser | null = null;
    let reachedPrivate = false;
    let timedOut = false;
    const stop = () => { void browser?.close().catch(() => { browser?.process()?.kill(); }); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal.addEventListener('abort', stop);
    try {
      try {
        browser = await (this.opts.launch ?? ((o) => puppeteer.launch(o)))(launchOptions(executablePath, profile, timeoutMs));
      } catch (err) {
        throw new AppError('BROWSER_MISSING', `browser did not start: ${String(err).slice(0, 300)}`);
      }
      if (signal.aborted) throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
      const cdp = await browser.target().createCDPSession();
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined);
      const page: Page = await browser.newPage();
      browser.on('targetcreated', (t) => { if (t.type() === 'page' && t !== page.target()) void t.page().then((p) => p?.close()).catch(() => undefined); });
      await page.setBypassServiceWorker(true);
      await page.evaluateOnNewDocument(LOCKDOWN_SCRIPT);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        void allowRequest(req.url(), req.resourceType(), this.check)
          .then((ok) => (ok ? req.continue() : req.abort('blockedbyclient')))
          .catch(() => undefined);
      });
      // Second line against DNS rebinding: the browser resolves names again after our check — if any answer
      // still came from an internal address, nothing of this page is used.
      page.on('response', (res) => {
        const ip = res.remoteAddress().ip?.replace(/^\[|\]$/g, '');
        if (ip && !isPublicAddress(ip)) reachedPrivate = true;
      });
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      if (!response || !response.ok()) throw unreadable(`status ${response?.status() ?? 'none'}`);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 10_000 }).catch(() => undefined);
      const raw = await page.evaluate('document.body ? document.body.innerText : ""');
      if (reachedPrivate) throw unreadable('blocked: answered from an internal address');
      return pageText(typeof raw === 'string' ? raw : '', this.maxChars);
    } catch (err) {
      if (timedOut) throw unreadable('timeout');
      throw err;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      if (browser) {
        const b = browser;
        await b.close().catch(() => { b.process()?.kill(); });
      }
      removeProfileDir(profile, this.opts.warn);
    }
  }
}
