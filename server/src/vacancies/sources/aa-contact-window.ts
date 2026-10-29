import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Browser, type Frame, type Page } from 'puppeteer-core';
import { findBrowser, removeProfileDir } from '../../applications/pdf.js';
import { AppError } from '../../errors.js';
import { isAaHost, jobdetailUrl } from '../aa-links.js';
import { parseContact } from '../contact-parse.js';
import { pageText } from './page-reader.js';
import { checkPublicUrl, isPublicAddress } from './safe-address.js';

/**
 * The text of the offer page once the employer's contact is visible (with the links off the AA site that appeared
 * with it, e.g. "Über Internetseite des Arbeitgebers"), or `cancelled` when the person closed the window.
 */
export type ContactWindowResult = { text: string; links: string[] } | { cancelled: true };

export interface ContactWindow {
  /** Opens the Arbeitsagentur offer `refnr` in a visible window; the person solves the captcha there. */
  readContact(refnr: string, signal: AbortSignal): Promise<ContactWindowResult>;
}

type Check = typeof checkPublicUrl;
export type ContactFindResult = 'ok' | 'none' | 'cancelled' | 'failed' | 'blocked' | 'timeout';
type Log = (event: 'vacancy.contactFind', data: { source: 'aa'; result: ContactFindResult }) => void;

/** Same characters as jobdetailRefnr(), but never starting with '-'. */
const REFNR = /^[A-Za-z0-9_.:][A-Za-z0-9_.:-]{4,39}$/;
const CAPTCHA = /captcha|Sicherheitsabfrage|Ich bin kein Roboter/i;
/** Lines the AA page shows only once the captcha is solved (B1 live checks). */
const REVEALED = /Bewerben Sie sich|Kontaktadresse/;
const APPLICATION_SECTION = /Bewerbung|Kontakt/i;
const MAX_LINKS = 3;
/** The contact must read the same on this many polls in a row (the block is drawn in steps). */
const STABLE_POLLS = 2;

/**
 * Runs in every frame: the visible text, mailto:/tel: links, and every http(s) link with the last heading before it.
 * A string, not a function: it must reach the page exactly as written.
 */
export const READ_FRAME_SCRIPT = `(() => {
  const links = [];
  let section = '';
  for (const el of document.querySelectorAll('h1, h2, h3, h4, h5, h6, a[href]')) {
    if (el.tagName !== 'A') { section = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80); continue; }
    if (/^https?:/i.test(el.href)) links.push({ href: el.href, section });
  }
  const body = document.body;
  return {
    text: body ? (body.innerText ?? body.textContent ?? '') : '',
    hrefs: [...document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]')].map((a) => a.getAttribute('href') || ''),
    links,
  };
})()`;

/**
 * Dismisses the cookie banner with its privacy-preserving button only ("Ablehnen", "Nur notwendige",
 * "Auswahl bestätigen" with nothing extra chosen) — never "akzeptieren": without such a button the person decides.
 * Looks into open shadow roots (the AA banner is a web component) and never touches anything inside a captcha.
 * Returns the text of the clicked button, or null.
 */
export const COOKIE_SCRIPT = `(() => {
  const REJECT = /^(Alle )?(ablehnen|Nur notwendige|Nur erforderliche|Auswahl bestätigen)/i;
  const roots = [document];
  while (roots.length) {
    const root = roots.pop();
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (!el.matches('button, [role="button"], a')) continue;
      if (el.closest('[id*="captcha" i], [class*="captcha" i]')) continue;
      const label = (el.innerText ?? el.textContent ?? '').trim();
      if (REJECT.test(label)) { el.click(); return label.slice(0, 60); }
    }
  }
  return null;
})()`;

/** Scrolls the application block ("Informationen zur Bewerbung", where the captcha is) into view. */
export const SCROLL_SCRIPT = `(() => {
  const heading = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((h) => /Informationen zur Bewerbung/i.test(h.textContent || ''));
  const target = heading || document.querySelector('[id*="captcha" i], [class*="captcha" i]');
  if (!target) return false;
  target.scrollIntoView({ block: 'center' });
  return true;
})()`;

/** A visible browser with its own throw-away profile; puppeteer's --disable-popup-blocking default is dropped. */
export function contactLaunchOptions(executablePath: string, userDataDir: string, timeoutMs: number) {
  return {
    executablePath, headless: false, userDataDir, timeout: timeoutMs, defaultViewport: null,
    ignoreDefaultArgs: ['--disable-popup-blocking'],
    args: [
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking',
      '--block-new-web-contents', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ],
  };
}

interface FrameRead { url: string; text: string; hrefs: string[]; links: Array<{ href: string; section: string }> }
interface PageRead { text: string; captcha: boolean; links: Array<{ href: string; section: string }> }

async function readFrame(f: Frame): Promise<FrameRead | null> {
  try {
    const r = await f.evaluate(READ_FRAME_SCRIPT) as Omit<FrameRead, 'url'> | null;
    if (!r || typeof r.text !== 'string') return null;
    return { url: f.url(), text: r.text, hrefs: Array.isArray(r.hrefs) ? r.hrefs : [], links: Array.isArray(r.links) ? r.links : [] };
  } catch {
    return null;
  }
}

/** All frames as one text; mailto:/tel: links become "E-Mail:"/"Tel.:" lines so the parser sees them. */
function combine(frames: FrameRead[]): PageRead {
  const extra = frames.flatMap((f) => f.hrefs).map((h) => {
    const value = decodeURIComponent(h.replace(/^(mailto|tel):/i, '').split('?')[0] ?? '').trim();
    return /^mailto:/i.test(h) ? `E-Mail: ${value}` : `Tel.: ${value}`;
  });
  return {
    text: [...frames.map((f) => f.text), ...extra].join('\n'),
    captcha: frames.some((f) => CAPTCHA.test(f.url) || CAPTCHA.test(f.text)),
    links: frames.flatMap((f) => f.links).filter((l) => !isAaHost(l.href)),
  };
}

/**
 * The text handed on: lines that were already on the page before the captcha and carry an e-mail or phone (a footer
 * hotline, the AA service number) are left out, so the parser can never take them for the employer's contact.
 */
export function withoutBaselineContacts(text: string, baseline: string): string {
  const before = new Set(baseline.split('\n').map((l) => l.trim()).filter(Boolean));
  return text.split('\n').filter((l) => {
    const t = l.trim();
    if (!before.has(t)) return true;
    const found = parseContact(t).found;
    return !found.includes('email') && !found.includes('phone');
  }).join('\n');
}

const cancelledByUser = () => new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
const unreadable = (why: string) => new AppError('BAD_REQUEST', `offer page not readable: ${why}`, 'pageUnreadable');

/**
 * The "find contact" window (spec 0.9.1 B): the installed Edge/Chrome opens exactly the Arbeitsagentur offer, visibly,
 * with a fresh temporary profile (deleted afterwards). The program dismisses the cookie banner with its
 * privacy-preserving button and scrolls to the application block — the person clicks and solves the captcha; the
 * program never touches it. Every 2 s it reads the page; the first read is the baseline, so footer addresses and
 * hotlines never count. It finishes when a new e-mail or phone reads the same twice in a row, or when the block was
 * revealed (captcha gone / "Bewerben Sie sich" new) and holds only links to the employer's site. Closing the window =
 * cancelled; 5 minutes = contactTimeout. One window at a time. The log gets only the result.
 */
export class AaContactWindow implements ContactWindow {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly find: () => string | null;
  private readonly check: Check;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly settleMs: number;
  private readonly maxChars: number;

  constructor(private readonly opts: {
    tmpRoot: string; find?: () => string | null; check?: Check;
    /** Whole window (default 5 min), poll interval (2 s), pause after the cookie click (1 s), text limit (60 000). */
    timeoutMs?: number; pollMs?: number; settleMs?: number; maxChars?: number;
    /** Tests: a fake browser instead of puppeteer.launch. */
    launch?: (options: ReturnType<typeof contactLaunchOptions>) => Promise<Browser>;
    warn?: (event: string, data: Record<string, unknown>) => void; log?: Log;
  }) {
    this.find = opts.find ?? (() => findBrowser());
    this.check = opts.check ?? checkPublicUrl;
    this.timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    this.pollMs = opts.pollMs ?? 2000;
    this.settleMs = opts.settleMs ?? 1000;
    this.maxChars = opts.maxChars ?? 60_000;
  }

  readContact(refnr: string, signal: AbortSignal): Promise<ContactWindowResult> {
    const run = this.chain.then(() => this.readOnce(refnr, signal));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private log(result: ContactFindResult): void {
    this.opts.log?.('vacancy.contactFind', { source: 'aa', result });
  }

  private async readOnce(refnr: string, signal: AbortSignal): Promise<ContactWindowResult> {
    if (!REFNR.test(refnr)) throw new AppError('BAD_REQUEST', 'not a Referenznummer');
    const executablePath = this.find();
    if (!executablePath) throw new AppError('BROWSER_MISSING', 'no Edge or Chrome found');
    if (signal.aborted) throw cancelledByUser();
    try {
      const result = await this.watch(executablePath, jobdetailUrl(refnr), signal);
      this.log('cancelled' in result ? 'cancelled' : parseContact(result.text).found.some((f) => f === 'email' || f === 'phone') ? 'ok' : 'none');
      return result;
    } catch (err) {
      const reason = err instanceof AppError ? err.reason : undefined;
      this.log(reason === 'contactTimeout' ? 'timeout' : reason === 'cancelledByUser' ? 'cancelled'
        : err instanceof AppError && err.detailsForLog.includes('blocked') ? 'blocked' : 'failed');
      throw err;
    }
  }

  private async watch(executablePath: string, url: string, signal: AbortSignal): Promise<ContactWindowResult> {
    fs.mkdirSync(this.opts.tmpRoot, { recursive: true });
    // `pdf-` prefix on purpose: BrowserPrinter's sweep removes such folders left behind by a crash.
    const profile = fs.mkdtempSync(path.join(this.opts.tmpRoot, 'pdf-contact-'));
    let browser: Browser | null = null;
    let closed = false;
    let timedOut = false;
    let reachedPrivate = false;
    // Wakes the poll loop early (window closed, stopped, time up, internal address) instead of waiting out a poll.
    let wake: (() => void) | null = null;
    const nudge = () => { const w = wake; wake = null; w?.(); };
    const sleep = (ms: number) => new Promise<void>((resolve) => {
      const t = setTimeout(() => { wake = null; resolve(); }, ms);
      wake = () => { clearTimeout(t); resolve(); };
    });
    const timer = setTimeout(() => { timedOut = true; nudge(); }, this.timeoutMs);
    signal.addEventListener('abort', nudge);
    const stopIfOver = () => {
      if (reachedPrivate) throw unreadable('blocked: answered from an internal address');
      if (signal.aborted) throw cancelledByUser();
      if (timedOut) throw new AppError('BAD_REQUEST', 'contact window: 5 minutes passed', 'contactTimeout');
    };
    try {
      try {
        browser = await (this.opts.launch ?? ((o) => puppeteer.launch(o)))(contactLaunchOptions(executablePath, profile, 30_000));
      } catch (err) {
        throw new AppError('BROWSER_MISSING', `browser did not start: ${String(err).slice(0, 300)}`);
      }
      browser.on('disconnected', () => { closed = true; nudge(); });
      if (signal.aborted) throw cancelledByUser();
      const cdp = await browser.target().createCDPSession();
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined);
      const page: Page = (await browser.pages())[0] ?? await browser.newPage();
      page.on('close', () => { closed = true; nudge(); });
      browser.on('targetcreated', (t) => { if (t.type() === 'page' && t !== page.target()) void t.page().then((p) => p?.close()).catch(() => undefined); });
      await page.setRequestInterception(true);
      // Pictures and fonts are allowed here (the captcha needs them); every address must still be public.
      page.on('request', (req) => {
        const u = req.url();
        if (u.startsWith('data:') || u.startsWith('blob:')) { void req.continue().catch(() => undefined); return; }
        void this.check(u).then((c) => (c.ok ? req.continue() : req.abort('blockedbyclient'))).catch(() => undefined);
      });
      // Second line against DNS rebinding: an answer from an internal address ends the window, nothing is used.
      page.on('response', (res) => {
        const ip = res.remoteAddress().ip?.replace(/^\[|\]$/g, '');
        if (ip && !isPublicAddress(ip)) { reachedPrivate = true; nudge(); }
      });

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      } catch (err) {
        if (closed) return { cancelled: true };
        stopIfOver();
        throw unreadable(/net::ERR_[A-Z_]+/.exec(String(err))?.[0] ?? 'navigation failed');
      }
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 10_000 }).catch(() => undefined);
      if (closed) return { cancelled: true };
      stopIfOver();
      await page.mainFrame().evaluate(COOKIE_SCRIPT).catch(() => null);
      await sleep(this.settleMs);
      await page.mainFrame().evaluate(SCROLL_SCRIPT).catch(() => false);

      let baseline: PageRead | null = null;
      let captchaSeen = false;
      let lastSignature = '';
      let stable = 0;
      for (;;) {
        if (closed) return { cancelled: true };
        stopIfOver();
        let frames: FrameRead[] = [];
        try { frames = (await Promise.all(page.frames().map(readFrame))).filter((f): f is FrameRead => f !== null); } catch { frames = []; }
        if (closed) return { cancelled: true };
        if (frames.length) {
          const now = combine(frames);
          if (now.captcha) captchaSeen = true;
          if (!baseline) {
            baseline = now;
          } else {
            const base = baseline;
            const parsed = parseContact(now.text);
            const c = parsed.contact;
            const newContact = (c.email !== '' && !base.text.includes(c.email)) || (c.phone !== '' && !base.text.includes(c.phone));
            const revealed = (captchaSeen && !now.captcha) || (REVEALED.test(now.text) && !REVEALED.test(base.text));
            const known = new Set(base.links.map((l) => l.href));
            const fresh = now.links.filter((l) => !known.has(l.href));
            const links = [...new Set((fresh.length ? fresh : now.links.filter((l) => APPLICATION_SECTION.test(l.section))).map((l) => l.href))].slice(0, MAX_LINKS);
            if (newContact || revealed) {
              // Compared on what is used, not the whole text: a live clock on the page must not keep it "unstable".
              const signature = JSON.stringify([newContact ? c : null, links]);
              stable = signature === lastSignature ? stable + 1 : 0;
              lastSignature = signature;
              if (stable >= STABLE_POLLS) return { text: pageText(withoutBaselineContacts(now.text, base.text), this.maxChars), links };
            } else {
              stable = 0;
              lastSignature = '';
            }
          }
        }
        await sleep(this.pollMs);
      }
    } catch (err) {
      // The person closing the window while something was still loading is a cancel, not an error.
      if (closed && !(err instanceof AppError && (err.reason === 'contactTimeout' || err.detailsForLog.includes('blocked')))) return { cancelled: true };
      throw err;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', nudge);
      if (browser) {
        const b = browser;
        await b.close().catch(() => { b.process()?.kill(); });
      }
      removeProfileDir(profile, this.opts.warn);
    }
  }
}
