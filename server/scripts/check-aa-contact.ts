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

const REFNR = /^[A-Za-z0-9_.:-]{5,40}$/;
const CAPTCHA = /captcha|friendlycaptcha|hcaptcha|recaptcha|Sicherheitsabfrage|Ich bin kein Roboter/i;
const MARKER = /Ansprechpartner|Kontakt|Arbeitgeber|Bewerbung an/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SKIPPED = new Set(['image', 'media', 'font']);

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

/** Text after a marker containing a phone-like run of 7-15 digits (spaces, slashes, dashes, brackets, + allowed between). The Referenznummer is removed first (it sits right after "Arbeitgeber"). */
function phoneNearMarker(text: string): boolean {
  for (const m of text.matchAll(MARKER)) {
    const after = text.slice(m.index ?? 0, (m.index ?? 0) + 600);
    for (const run of after.matchAll(/[+(]?\d[\d\s/()-]{5,}\d/g)) {
      const digits = run[0].replace(/\D/g, '').length;
      if (digits >= 7 && digits <= 15) return true;
    }
  }
  return false;
}

interface FrameRead { url: string; text: string; mailto: number; tel: number }

async function readFrame(f: Frame): Promise<FrameRead | null> {
  try {
    const r = await f.evaluate(() => ({
      text: document.body ? document.body.innerText : '',
      mailto: document.querySelectorAll('a[href^="mailto:"]').length,
      tel: document.querySelectorAll('a[href^="tel:"]').length,
    }));
    return { url: f.url(), ...r };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const executablePath = findBrowser();
  if (!executablePath) usage('No Edge or Chrome found.');
  const root = path.join(os.tmpdir(), 'bp-aa-contact');
  fs.mkdirSync(root, { recursive: true });
  const profile = fs.mkdtempSync(path.join(root, 'profile-'));
  const blocked: Record<string, number> = {};
  let browser: Browser | null = null;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    if (browser) await browser.close().catch(() => browser?.process()?.kill());
    removeProfileDir(profile);
  };
  process.on('SIGINT', () => { console.log('\nInterrupted.'); void close().then(() => process.exit(130)); });

  try {
    browser = await puppeteer.launch({
      executablePath, headless: false, userDataDir: profile, defaultViewport: null,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync'],
    });
    let windowClosed = false;
    browser.on('disconnected', () => { windowClosed = true; });
    const page = (await browser.pages())[0] ?? await browser.newPage();
    page.on('close', () => { windowClosed = true; });
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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) => console.log(`Navigation: ${/net::ERR_[A-Z_]+/.exec(String(e))?.[0] ?? 'error'}`));
    const webdriver = await page.evaluate(() => navigator.webdriver).catch(() => 'unknown');
    console.log(`Opened ${url} (navigator.webdriver = ${String(webdriver)}). Solve the captcha in the window; waiting up to ${timeoutS} s.`);

    let captchaKind: string | null = null;
    let outcome = 'timeout';
    let last: FrameRead[] = [];
    let markers = new Set<string>();
    while (Date.now() - started < timeoutS * 1000) {
      if (windowClosed) { outcome = 'window closed'; break; }
      const frames = (await Promise.all(page.frames().map(readFrame))).filter((x): x is FrameRead => x !== null);
      if (frames.length) last = frames;
      for (const f of frames) {
        const m = CAPTCHA.exec(f.url) ?? CAPTCHA.exec(f.text);
        if (m && !captchaKind) { captchaKind = m[0]; console.log(`Captcha seen after ${Math.round((Date.now() - started) / 1000)} s: "${m[0]}"`); }
      }
      const all = frames.map((f) => f.text).join('\n').split(refnr).join(' ');
      markers = new Set([...all.matchAll(MARKER)].map((m) => m[0]));
      const links = frames.reduce((n, f) => n + f.mailto + f.tel, 0);
      if (EMAIL.test(all) || links > 0 || phoneNearMarker(all)) {
        outcome = `contact found after ${Math.round((Date.now() - started) / 1000)} s`;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    const out = path.join(root, `aa-contact-${refnr.replace(/[^A-Za-z0-9_-]/g, '_')}.txt`);
    if (last.length) {
      fs.writeFileSync(out, last.map((f, i) => (i === 0 ? f.text : `--- frame ${i} ---\n${f.text}`)).join('\n\n'), 'utf8');
    }
    console.log('--- result ---');
    console.log(`captcha: ${captchaKind ? `seen ("${captchaKind}")` : 'not seen'}`);
    console.log(`navigator.webdriver: ${String(webdriver)}`);
    console.log(`outcome: ${outcome}`);
    console.log(`markers: ${[...markers].join(', ') || 'none'}`);
    console.log(`mailto links: ${last.reduce((n, f) => n + f.mailto, 0)}, tel links: ${last.reduce((n, f) => n + f.tel, 0)}`);
    console.log(`frames read: ${last.length}; blocked requests: ${JSON.stringify(blocked)}`);
    console.log(last.length ? `page text: ${out}` : 'page text: nothing read');
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
  process.exit(1);
});
