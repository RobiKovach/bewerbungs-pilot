import fs from 'node:fs';
import path from 'node:path';
import { type Browser, type Page } from 'puppeteer-core';
import { findBrowser, removeProfileDir, loadPuppeteer } from '../../applications/pdf.js';
import { AppError } from '../../errors.js';
import { checkPublicUrl, isPublicAddress } from './safe-address.js';

/** A link of a read page: absolute http(s), mailto: or tel:; text cut to 80 characters. */
export interface PageLink { text: string; href: string }
/** One read page: `url` after redirects. */
export interface PageRead { url: string; text: string; links: PageLink[] }
/** Several pages with one browser under one deadline (0.13.0). Always `close` it: until then the reader is held. */
export interface ReadSession { open(url: string): Promise<PageRead>; close(): Promise<void> }

export interface PageReader {
  /** The visible text of a pasted vacancy link (not Arbeitsagentur), or BROWSER_MISSING / BAD_REQUEST pageUnreadable. */
  read(url: string, signal: AbortSignal): Promise<string>;
  /**
   * A session for several pages: `deadlineMs` is an absolute time (`Date.now() + budget`) shared by all its pages;
   * an `open` after it throws pageUnreadable `timeout`. BROWSER_MISSING when no Edge/Chrome is installed.
   */
  session(signal: AbortSignal, deadlineMs: number): Promise<ReadSession>;
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

/** Links taken from one page; the rest are ignored (a footer of a group of companies can hold hundreds). */
export const MAX_LINKS = 300;
const MAX_LINK_TEXT = 80;
const MAX_HREF = 2000;
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Every `a[href]` of the page: the DOM already makes `href` absolute; duplicates (same link, same text) once. */
const LINKS_SCRIPT = `(() => {
  const out = []; const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = String(a.href || '');
    const text = String(a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, ${MAX_LINK_TEXT});
    const key = href + '\\n' + text;
    if (!href || seen.has(key)) continue;
    seen.add(key); out.push({ text, href });
    if (out.length >= ${MAX_LINKS * 2}) break;
  }
  return out;
})()`;

/**
 * The page's links as data from an untrusted page: only http(s), mailto and tel, resolved against the page's own
 * address (a relative link stays usable), text cut to 80 characters, at most MAX_LINKS.
 */
export function cleanLinks(raw: unknown, pageUrl: string): PageLink[] {
  if (!Array.isArray(raw)) return [];
  const out: PageLink[] = [];
  for (const item of raw) {
    if (out.length >= MAX_LINKS) break;
    if (!item || typeof item !== 'object') continue;
    const { text, href } = item as { text?: unknown; href?: unknown };
    if (typeof href !== 'string' || href.length > MAX_HREF) continue;
    let url: URL;
    try { url = new URL(href, pageUrl); } catch { continue; }
    if (!LINK_SCHEMES.has(url.protocol)) continue;
    out.push({ text: typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, MAX_LINK_TEXT) : '', href: url.href });
  }
  return out;
}

const cancelled = () => new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');

/**
 * Opens pasted vacancy links and company pages in the installed Edge/Chrome (spec 0.8.3, section 6a; 0.13.0 sessions):
 * a fresh temporary profile (no cookies, no accounts, deleted afterwards), JavaScript on (career pages are drawn by
 * it), every request filtered by `allowRequest`, downloads and new windows refused. One read or session at a time.
 * A session keeps one browser for several pages (one tab at a time) under one deadline. The log gets only the host
 * and the result, once per page — never the page text or the full link.
 */
export class BrowserPageReader implements PageReader {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly find: () => string | null;
  private readonly check: Check;
  private readonly timeoutMs: number;
  private readonly maxChars: number;

  constructor(private readonly opts: {
    tmpRoot: string; find?: () => string | null; check?: Check; timeoutMs?: number; maxChars?: number;
    /** Shorter page text is refused by `read` as unreadable (and logged as 'too-short'); sessions take any length. */
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

  async read(url: string, signal: AbortSignal): Promise<string> {
    const s = await this.session(signal, Date.now() + this.timeoutMs);
    try {
      return (await (s as BrowserSession).openWith(url, this.opts.minChars ?? 0)).text;
    } finally {
      await s.close();
    }
  }

  /** Waits for the reader to be free; holds it until `close` (a session and a plain read never overlap). */
  session(signal: AbortSignal, deadlineMs: number): Promise<ReadSession> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const start = this.chain.then(() => {
      const executablePath = this.find();
      if (!executablePath) throw new AppError('BROWSER_MISSING', 'no Edge or Chrome found');
      if (signal.aborted) throw cancelled();
      return new BrowserSession({
        executablePath, signal, deadlineMs, release, check: this.check, maxChars: this.maxChars,
        tmpRoot: this.opts.tmpRoot, launch: this.opts.launch, warn: this.opts.warn, log: this.opts.log,
      });
    });
    this.chain = start.then(() => held, () => undefined);
    return start;
  }
}

interface SessionOpts {
  executablePath: string; signal: AbortSignal; deadlineMs: number; release: () => void; check: Check; maxChars: number;
  tmpRoot: string; launch?: (options: ReturnType<typeof launchOptions>) => Promise<Browser>;
  warn?: (event: string, data: Record<string, unknown>) => void; log?: Log;
}

/**
 * One browser, started at the first `open` (a blocked or hanging first address never starts it). Pages are opened
 * one after another; every tab gets the request filter, the lockdown script and the internal-address check. A popup
 * of a page is closed at once. `close` ends the browser, deletes the profile and frees the reader — once.
 */
class BrowserSession implements ReadSession {
  private browser: Browser | null = null;
  private profile: string | null = null;
  private expectPage = false;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly stop = () => { void this.shutBrowser(); };

  constructor(private readonly o: SessionOpts) {
    o.signal.addEventListener('abort', this.stop);
  }

  open(url: string): Promise<PageRead> {
    return this.openWith(url, 0);
  }

  /** `minChars` > 0 only for the single-page `read` (its 'too-short' refusal). */
  openWith(url: string, minChars: number): Promise<PageRead> {
    const run = this.queue.then(() => this.openOnce(url, minChars));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.o.signal.removeEventListener('abort', this.stop);
    try {
      await this.shutBrowser();
    } finally {
      if (this.profile) removeProfileDir(this.profile, this.o.warn);
      this.profile = null;
      this.o.release();
    }
  }

  private async shutBrowser(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => { b.process()?.kill(); });
  }

  private async openOnce(url: string, minChars: number): Promise<PageRead> {
    const host = hostOf(url);
    const log = (result: Parameters<Log>[1]['result']) => this.o.log?.('vacancy.pageRead', { host, result });
    if (this.closed) throw unreadable('session closed');
    if (this.o.signal.aborted) throw cancelled();
    const remaining = this.o.deadlineMs - Date.now();
    if (remaining <= 0) {
      log('failed');
      throw unreadable('timeout');
    }
    // One limit for the whole page, starting before the address check (its DNS lookup can hang too).
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const limit = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(unreadable('timeout')), remaining);
      onAbort = () => reject(cancelled());
      this.o.signal.addEventListener('abort', onAbort);
    });
    limit.catch(() => undefined);
    const race = <T>(p: Promise<T>): Promise<T> => { p.catch(() => undefined); return Promise.race([p, limit]); };
    let stage: 'check' | 'browse' = 'check';
    let page: Page | null = null;
    try {
      const checked = await race(this.o.check(url));
      if (!checked.ok) {
        log('blocked');
        throw unreadable('blocked address');
      }
      stage = 'browse';
      const browser = await race(this.ensureBrowser(remaining));
      this.expectPage = true;
      page = await race(browser.newPage());
      this.expectPage = false;
      const read = await race(this.browse(page, url));
      if (read.text.length < minChars) {
        log('too-short');
        throw unreadable('too short');
      }
      log('ok');
      return read;
    } catch (err) {
      this.expectPage = false;
      if (this.o.signal.aborted) throw cancelled();
      if (err instanceof AppError) {
        // Logged once per page: 'blocked' and 'too-short' were logged where they were decided.
        const logged = (stage === 'check' && err.detailsForLog.endsWith('blocked address')) || err.detailsForLog.endsWith('too short');
        if (!logged) log(stage === 'browse' && err.detailsForLog.includes('blocked') ? 'blocked' : 'failed');
        throw err;
      }
      // Only the browser's short error code goes on: its messages carry the full link (with its query string).
      const code = /net::ERR_[A-Z_]+/.exec(String(err))?.[0] ?? (err instanceof Error ? err.name : 'Error');
      log(code === 'net::ERR_BLOCKED_BY_CLIENT' ? 'blocked' : 'failed');
      throw unreadable(code);
    } finally {
      clearTimeout(timer);
      if (onAbort) this.o.signal.removeEventListener('abort', onAbort);
      if (page) { const p = page; void Promise.resolve().then(() => p.close?.()).catch(() => undefined); }
    }
  }

  private async ensureBrowser(timeoutMs: number): Promise<Browser> {
    if (this.browser) return this.browser;
    fs.mkdirSync(this.o.tmpRoot, { recursive: true });
    // `pdf-` prefix on purpose: BrowserPrinter's sweep removes such folders left behind by a crash.
    this.profile ??= fs.mkdtempSync(path.join(this.o.tmpRoot, 'pdf-read-'));
    let browser: Browser;
    try {
      browser = await (this.o.launch ?? (async (opts) => (await loadPuppeteer()).launch(opts)))(launchOptions(this.o.executablePath, this.profile, timeoutMs));
    } catch (err) {
      throw new AppError('BROWSER_MISSING', `browser did not start: ${String(err).slice(0, 300)}`);
    }
    if (this.closed || this.o.signal.aborted) {
      await browser.close().catch(() => { browser.process()?.kill(); });
      throw cancelled();
    }
    this.browser = browser;
    const cdp = await browser.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined);
    // Our own tab is the one page expected while `newPage` runs; any other page (a popup) is closed at once.
    browser.on('targetcreated', (t) => {
      if (t.type() !== 'page') return;
      if (this.expectPage) { this.expectPage = false; return; }
      void t.page().then((p) => p?.close()).catch(() => undefined);
    });
    return browser;
  }

  private async browse(page: Page, url: string): Promise<PageRead> {
    let reachedPrivate = false;
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(LOCKDOWN_SCRIPT);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      void allowRequest(req.url(), req.resourceType(), this.o.check)
        .then((ok) => (ok ? req.continue() : req.abort('blockedbyclient')))
        .catch(() => undefined);
    });
    // Second line against DNS rebinding: the browser resolves names again after our check — if any answer
    // still came from an internal address, nothing of this page is used.
    page.on('response', (res) => {
      const ip = res.remoteAddress().ip?.replace(/^\[|\]$/g, '');
      if (ip && !isPublicAddress(ip)) reachedPrivate = true;
    });
    const remaining = Math.max(1, this.o.deadlineMs - Date.now());
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: remaining });
    if (!response || !response.ok()) throw unreadable(`status ${response?.status() ?? 'none'}`);
    await page.waitForNetworkIdle({ idleTime: 500, timeout: Math.min(10_000, Math.max(1, this.o.deadlineMs - Date.now())) }).catch(() => undefined);
    const raw = await page.evaluate('document.body ? document.body.innerText : ""');
    const finalUrl = typeof page.url === 'function' ? (page.url() || url) : url;
    const links = cleanLinks(await page.evaluate(LINKS_SCRIPT).catch(() => []), finalUrl);
    if (reachedPrivate) throw unreadable('blocked: answered from an internal address');
    return { url: finalUrl, text: pageText(typeof raw === 'string' ? raw : '', this.o.maxChars), links };
  }
}
