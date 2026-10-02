import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import puppeteer, { type Browser } from 'puppeteer-core';
import { AppError } from '../errors.js';

export interface PdfPrinter {
  available(): boolean;
  print(html: string): Promise<Buffer>;
}

/** Edge first (always on Windows 10/11 unless removed), then Chrome (spec, section 4). BP_BROWSER overrides for development. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = fs.existsSync): string | null {
  const join = path.win32.join;
  const candidates = [
    env.BP_BROWSER,
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    env.ProgramFiles && join(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    env.ProgramFiles && join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const c of candidates) if (c && exists(c)) return c;
  return null;
}

const PRINT_TIMEOUT_MS = 30_000;

/**
 * Prints our own HTML with the installed browser, one print at a time. Each print gets a fresh temporary browser
 * profile (deleted afterwards), JavaScript is off and every request except data: URIs is blocked, so nothing but the
 * given HTML (with its embedded photo) can end up in the PDF.
 */
export class BrowserPrinter implements PdfPrinter {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly find: () => string | null;

  constructor(private readonly opts: { tmpRoot: string; find?: () => string | null }) {
    this.find = opts.find ?? (() => findBrowser());
  }

  available(): boolean {
    return this.find() !== null;
  }

  print(html: string): Promise<Buffer> {
    const run = this.chain.then(() => this.printOnce(html));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async printOnce(html: string): Promise<Buffer> {
    const executablePath = this.find();
    if (!executablePath) throw new AppError('BROWSER_MISSING', 'no Edge or Chrome found');
    fs.mkdirSync(this.opts.tmpRoot, { recursive: true });
    const profile = fs.mkdtempSync(path.join(this.opts.tmpRoot, 'pdf-'));
    let browser: Browser | null = null;
    try {
      try {
        browser = await puppeteer.launch({
          executablePath, headless: true, userDataDir: profile, timeout: PRINT_TIMEOUT_MS,
          args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking'],
        });
      } catch (err) {
        throw new AppError('BROWSER_MISSING', `browser did not start: ${String(err).slice(0, 300)}`);
      }
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => { if (req.url().startsWith('data:')) void req.continue(); else void req.abort(); });
      await page.setContent(html, { waitUntil: 'load', timeout: PRINT_TIMEOUT_MS });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, timeout: PRINT_TIMEOUT_MS });
      return Buffer.from(pdf);
    } finally {
      await browser?.close().catch(() => undefined);
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

export async function countPages(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf)).getPageCount();
}

export interface BundlePart { name: string; data: Uint8Array }

/** Letter → CV → attachments as one PDF (spec, decision 8). */
export async function bundlePdfs(parts: BundlePart[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const part of parts) {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(part.data);
    } catch (err) {
      throw new AppError('CONFLICT', `unreadable PDF part: ${String(err).slice(0, 200)}`, 'attachmentUnreadable', { name: part.name });
    }
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return Buffer.from(await out.save());
}
