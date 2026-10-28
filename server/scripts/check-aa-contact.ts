// Manual live check for the AA contact window (0.9.1 part B, gate B1). Run: npm run check:aa-contact -- <Referenznummer> [--block-images] [--timeout-s N]
// Opens the job page in a VISIBLE Edge/Chrome; the person solves the captcha. Prints only facts (never contact values);
// the page text goes to a file under the system temp folder (holds real contact data — stays outside the repo).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Browser, type Frame } from 'puppeteer-core';
import { findBrowser, removeProfileDir } from '../src/applications/pdf.js';
import { jobdetailUrl } from '../src/vacancies/sources/arbeitsagentur.js';
import { checkPublicUrl } from '../src/vacancies/sources/safe-address.js';

// Same characters as jobdetailRefnr(), but never starting with '-' (would look like a flag).
const REFNR = /^[A-Za-z0-9_.:][A-Za-z0-9_.:-]{4,39}$/;
const CAPTCHA = /captcha|friendlycaptcha|hcaptcha|recaptcha|Sicherheitsabfrage|Ich bin kein Roboter/gi;
const MARKER = /Ansprechpartner|Kontakt|Arbeitgeber|Bewerbung an/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RUN = /[+(]?\d[\d\s/()-]{5,}\d/g;
const SKIPPED = new Set(['image', 'media', 'font']);
const POLL_MS = 2000;
const STABLE_POLLS = 2;

function usage(msg: string): never {
  console.error(`${msg}\nUsage: npm run check:aa-contact -- <Referenznummer> [--block-images] [--timeout-s N]`);
  process.exit(1);
}

const args = process.argv.slice(2);
const blockImages = args.includes('--block-images');
const tIdx = args.indexOf('--timeout-s');
const timeoutS = tIdx >= 0 ? Number(args[tIdx + 1]) : 300;
if (!Number.isInteger(timeoutS) || timeoutS < 1 || timeoutS > 3600) usage('--timeout-s must be a whole number of seconds (1-3600).');
const rest = args.filter((a, i) => a !== '--block-images' && a !== '--timeout-s' && !(tIdx >= 0 && i === tIdx + 1));
if (rest.length !== 1 || !REFNR.test(rest[0])) usage('Expected exactly one valid Referenznummer.');
const refnr = rest[0];
const url = jobdetailUrl(refnr);

interface FrameRead { url: string; text: string; hrefs: string[] }
/** What could be a contact: emails, mailto:/tel: links, phone-like runs (7-15 digits). Values stay in memory only. */
interface Signals { emails: Set<string>; hrefs: Set<string>; phones: Set<string> }

async function readFrame(f: Frame): Promise<FrameRead | null> {
  try {
    const r = await f.evaluate(() => ({
      text: document.body ? document.body.innerText : '',
      hrefs: [...document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]')].map((a) => a.getAttribute('href') ?? ''),
    }));
    return { url: f.url(), ...r };
  } catch {
    return null;
  }
}

/** The Referenznummer is removed first: it sits right after "Arbeitgeber" and looks like a long number. */
function signalsOf(frames: FrameRead[]): Signals {
  const text = frames.map((f) => f.text).join('\n').split(refnr).join(' ');
  const phones = new Set<string>();
  for (const run of text.matchAll(PHONE_RUN)) {
    const digits = run[0].replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) phones.add(digits);
  }
  return {
    emails: new Set([...text.matchAll(EMAIL)].map((m) => m[0].toLowerCase())),
    hrefs: new Set(frames.flatMap((f) => f.hrefs)),
    phones,
  };
}

const newOnes = (now: Set<string>, base: Set<string>) => [...now].filter((x) => !base.has(x)).length;

async function main(): Promise<void> {
  const executablePath = findBrowser();
  if (!executablePath) {
    console.error('No Edge or Chrome found.');
    process.exit(1);
  }
  const root = path.join(os.tmpdir(), 'bp-aa-contact');
  fs.mkdirSync(root, { recursive: true });
  const profile = fs.mkdtempSync(path.join(root, 'profile-'));
  const blocked: Record<string, number> = {};

  // Cleanup runs once, whoever asks first (finally, Ctrl+C, a second Ctrl+C), and also catches a browser that is
  // still starting when Ctrl+C comes.
  let launching: Promise<Browser> | null = null;
  let closed: Promise<void> | null = null;
  const close = () => {
    closed ??= (async () => {
      const b = launching ? await launching.catch(() => null) : null;
      if (b) await b.close().catch(() => { b.process()?.kill(); });
      removeProfileDir(profile);
    })();
    return closed;
  };
  process.on('SIGINT', () => { console.log('\nInterrupted.'); void close().then(() => process.exit(130)); });

  try {
    launching = puppeteer.launch({
      executablePath, headless: false, userDataDir: profile, defaultViewport: null,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync'],
    });
    const browser = await launching;
    if (closed) return; // Ctrl+C during the start: close() is already shutting it down
    let windowClosed = false;
    browser.on('disconnected', () => { windowClosed = true; });
    const page = (await browser.pages())[0] ?? await browser.newPage();
    page.on('close', () => { windowClosed = true; });
    let popups = 0;
    browser.on('targetcreated', (t) => {
      if (t.type() === 'page' && t !== page.target()) { popups++; void t.page().then((p) => p?.close()).catch(() => undefined); }
    });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      void (async () => {
        const u = req.url();
        if (blockImages && SKIPPED.has(req.resourceType())) { blocked.images = (blocked.images ?? 0) + 1; return req.abort('blockedbyclient'); }
        if (u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
        const c = await checkPublicUrl(u);
        if (!c.ok) { blocked[c.why] = (blocked[c.why] ?? 0) + 1; return req.abort('blockedbyclient'); }
        return req.continue();
      })().catch(() => undefined);
    });

    const started = Date.now();
    const secs = () => Math.round((Date.now() - started) / 1000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) => console.log(`Navigation: ${/net::ERR_[A-Z_]+/.exec(String(e))?.[0] ?? 'error'}`));
    // The page is drawn by scripts: the baseline must see the finished chrome, not a half-rendered page.
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 10_000 }).catch(() => undefined);
    const webdriver = await page.evaluate(() => navigator.webdriver).catch(() => 'unknown');
    console.log(`Opened ${url} (navigator.webdriver = ${String(webdriver)}). Solve the captcha in the window; waiting up to ${timeoutS} s.`);

    const captchaKinds = new Set<string>();
    let captchaVisible = false;
    let captchaGoneAt: number | null = null;
    let baseline: Signals | null = null;
    let firstNewAt: number | null = null;
    let lastText = '';
    let stablePolls = 0;
    let outcome = 'timeout';
    let last: FrameRead[] = [];
    let markers = new Set<string>();
    let fresh = { emails: 0, hrefs: 0, phones: 0 };
    // At least one poll even when loading the page used up a short --timeout-s.
    for (;;) {
      if (windowClosed) { outcome = 'window closed'; break; }
      const frames = (await Promise.all(page.frames().map(readFrame))).filter((x): x is FrameRead => x !== null);
      if (frames.length) {
        last = frames;
        // Captcha state of this poll: every distinct match is kept; "gone" = was visible, now no frame shows it.
        let visibleNow = false;
        for (const f of frames) {
          for (const m of `${f.url}\n${f.text}`.matchAll(CAPTCHA)) {
            visibleNow = true;
            if (!captchaKinds.has(m[0])) { captchaKinds.add(m[0]); console.log(`Captcha marker after ${secs()} s: "${m[0]}"`); }
          }
        }
        if (captchaVisible && !visibleNow && captchaGoneAt === null) { captchaGoneAt = secs(); console.log(`Captcha text disappeared after ${captchaGoneAt} s`); }
        captchaVisible = visibleNow;

        const all = frames.map((f) => f.text).join('\n');
        markers = new Set([...all.matchAll(MARKER)].map((m) => m[0]));
        const now = signalsOf(frames);
        // The first read (before any captcha interaction) is the page chrome: footer emails, hotlines, addresses.
        if (!baseline) {
          baseline = now;
          console.log(`Baseline: ${now.emails.size} emails, ${now.hrefs.size} mailto/tel links, ${now.phones.size} phone-like runs (ignored from now on)`);
        } else {
          fresh = { emails: newOnes(now.emails, baseline.emails), hrefs: newOnes(now.hrefs, baseline.hrefs), phones: newOnes(now.phones, baseline.phones) };
          if (firstNewAt === null && fresh.emails + fresh.hrefs + fresh.phones > 0) {
            firstNewAt = secs();
            console.log(`New contact-like data after ${firstNewAt} s — waiting until the page is stable`);
          }
          if (firstNewAt !== null) {
            stablePolls = all === lastText ? stablePolls + 1 : 0;
            if (stablePolls >= STABLE_POLLS) { outcome = `contact found after ${firstNewAt} s (stable at ${secs()} s)`; break; }
          }
        }
        lastText = all;
      }
      if (Date.now() - started >= timeoutS * 1000) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    const out = path.join(root, `aa-contact-${refnr.replace(/[^A-Za-z0-9_-]/g, '_')}.txt`);
    if (last.length) {
      fs.writeFileSync(out, last.map((f, i) => (i === 0 ? f.text : `--- frame ${i} ---\n${f.text}`)).join('\n\n'), 'utf8');
    }
    console.log('--- result ---');
    console.log(`captcha markers: ${captchaKinds.size ? [...captchaKinds].map((k) => `"${k}"`).join(', ') : 'none'}`);
    console.log(`captcha text disappeared: ${captchaGoneAt === null ? 'no' : `after ${captchaGoneAt} s`}`
      + (firstNewAt === null ? '' : ` — ${captchaGoneAt !== null && captchaGoneAt <= firstNewAt ? 'before' : 'NOT before'} the contact appeared`));
    console.log(`navigator.webdriver: ${String(webdriver)}`);
    console.log(`outcome: ${outcome}`);
    console.log(`markers: ${[...markers].join(', ') || 'none'}`);
    console.log(`new vs baseline: ${fresh.emails} emails, ${fresh.hrefs} mailto/tel links, ${fresh.phones} phone-like runs`);
    console.log(`frames read: ${last.length}; popups closed: ${popups}; blocked requests: ${JSON.stringify(blocked)}`);
    console.log(last.length ? `page text: ${out}` : 'page text: nothing read');
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
  process.exit(1);
});
