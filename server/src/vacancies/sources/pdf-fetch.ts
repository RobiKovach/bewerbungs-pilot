import { countLetters, MIN_PDF_LETTERS, pdfBufferToText } from '../../profile/pdf-text.js';
import { AppError } from '../../errors.js';
import type { Lookup } from './safe-address.js';
import { readBody, safeGet, SafeGetError, type Check, type SafeGetWhy } from './safe-get.js';

export type PdfResult =
  | { ok: true; text: string; host: string }
  | { ok: false; host: string; why: 'blocked' | 'failed' | 'not-pdf' | 'too-large' | 'no-text' };

export interface PdfFetcher {
  /** Text of the PDF behind a pasted link; never throws for a bad remote, only LLM_CANCELLED when `signal` aborts. */
  fetch(url: string, signal: AbortSignal, budgetMs?: number): Promise<PdfResult>;
}

type Log = (event: string, data: { host: string; result: 'ok' | PdfFail }) => void;
type PdfFail = Extract<PdfResult, { ok: false }>['why'];

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAGIC = '%PDF-';
/** What a failed safe GET means for a PDF link. */
const PDF_WHY: Record<SafeGetWhy, PdfFail> = {
  blocked: 'blocked', timeout: 'failed', tooBig: 'too-large', status: 'failed', content: 'not-pdf', network: 'failed',
};
const HEADERS = { 'user-agent': 'BewerbungsPilot', accept: 'application/pdf,*/*' };

const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return ''; } };

/** A remote problem that ends the download with this result (thrown inside, caught in `fetchOnce`). */
class Stop extends Error {
  constructor(readonly why: PdfFail) { super(why); }
}

/**
 * Downloads one PDF of a pasted link (spec 0.9.1, A3) without a browser: every URL and every redirect (at most 5)
 * passes `checkPublicUrl`, and the socket connects only to addresses that pass `isPublicAddress` — the name is
 * resolved once, inside the connection, so a second DNS answer cannot point it elsewhere. At most 10 MB (counted,
 * `Content-Length` is not trusted), one time limit for the whole download, the file must start with `%PDF-`. Only
 * the text is kept; one download at a time; the log gets the host and the result, never the link or the text.
 */
export class HttpPdfFetcher implements PdfFetcher {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: {
    timeoutMs?: number;
    /** Tests: a URL check and a DNS resolver / address rule that let a local test server count as public. */
    check?: Check; lookup?: Lookup; isPublic?: (ip: string) => boolean;
    log?: Log;
  } = {}) {}

  fetch(url: string, signal: AbortSignal, budgetMs?: number): Promise<PdfResult> {
    const run = this.chain.then(() => this.fetchOnce(url, signal, budgetMs ?? this.opts.timeoutMs ?? 25_000));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async fetchOnce(url: string, signal: AbortSignal, budgetMs: number): Promise<PdfResult> {
    const host = hostOf(url);
    if (signal.aborted) throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
    const stop = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop.abort(); }, budgetMs);
    const onAbort = () => stop.abort();
    signal.addEventListener('abort', onAbort);
    let result: PdfResult;
    try {
      result = { ok: true, host, text: await this.download(url, stop.signal) };
    } catch (err) {
      if (signal.aborted && !timedOut) {
        this.opts.log?.('vacancy.pdfRead', { host, result: 'failed' });
        throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
      }
      const why: PdfFail = err instanceof Stop ? err.why : 'failed';
      result = { ok: false, host, why };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    this.opts.log?.('vacancy.pdfRead', { host, result: result.ok ? 'ok' : result.why });
    return result;
  }

  private async download(url: string, signal: AbortSignal): Promise<string> {
    let bytes: Uint8Array;
    try {
      const res = await safeGet(url, { signal, headers: HEADERS, check: this.opts.check, lookup: this.opts.lookup, isPublic: this.opts.isPublic });
      bytes = await readBody(res, { maxBytes: MAX_PDF_BYTES, prefix: MAGIC });
    } catch (err) {
      throw err instanceof SafeGetError ? new Stop(PDF_WHY[err.why]) : err;
    }
    let text: string;
    // pdf.js may take over the bytes it is given, so they are not used after this call.
    try { text = await pdfBufferToText(bytes); } catch { throw new Stop('failed'); }
    if (countLetters(text) < MIN_PDF_LETTERS) throw new Stop('no-text');
    return text;
  }
}

