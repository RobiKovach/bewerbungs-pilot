import dns from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, request } from 'undici';
import { countLetters, MIN_PDF_LETTERS, pdfBufferToText } from '../../profile/pdf-text.js';
import { AppError } from '../../errors.js';
import { checkPublicUrl, isPublicAddress, type Lookup } from './safe-address.js';

export type PdfResult =
  | { ok: true; text: string; host: string }
  | { ok: false; host: string; why: 'blocked' | 'failed' | 'not-pdf' | 'too-large' | 'no-text' };

export interface PdfFetcher {
  /** Text of the PDF behind a pasted link; never throws for a bad remote, only LLM_CANCELLED when `signal` aborts. */
  fetch(url: string, signal: AbortSignal, budgetMs?: number): Promise<PdfResult>;
}

type Check = typeof checkPublicUrl;
type Log = (event: string, data: { host: string; result: 'ok' | PdfFail }) => void;
type PdfFail = Extract<PdfResult, { ok: false }>['why'];

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAGIC = '%PDF-';
const HEADERS = { 'user-agent': 'BewerbungsPilot', accept: 'application/pdf,*/*' };

const defaultLookup: Lookup = async (host) => (await dns.promises.lookup(host, { all: true })).map((a) => a.address);
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
    const state = { blocked: false };
    const agent = new Agent({ connect: { lookup: this.pinnedLookup(state) } });
    let result: PdfResult;
    try {
      result = { ok: true, host, text: await this.download(url, agent, stop.signal, state) };
    } catch (err) {
      if (signal.aborted && !timedOut) {
        this.opts.log?.('vacancy.pdfRead', { host, result: 'failed' });
        throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
      }
      const why: PdfFail = err instanceof Stop ? err.why : state.blocked ? 'blocked' : 'failed';
      result = { ok: false, host, why };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      await agent.destroy().catch(() => undefined);
    }
    this.opts.log?.('vacancy.pdfRead', { host, result: result.ok ? 'ok' : result.why });
    return result;
  }

  /** net.connect's DNS step: every address must be public, else the connection fails and the download is 'blocked'. */
  private pinnedLookup(state: { blocked: boolean }): LookupFunction {
    const resolve = this.opts.lookup ?? defaultLookup;
    const isPublic = this.opts.isPublic ?? isPublicAddress;
    return (hostname, options, cb) => {
      resolve(hostname).then((addresses) => {
        if (addresses.length === 0 || !addresses.every(isPublic)) {
          state.blocked = true;
          throw new Error('blocked: not a public address');
        }
        const all = addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
        if (options.all) cb(null, all);
        else cb(null, all[0].address, all[0].family);
      }).catch((err: Error) => cb(err as NodeJS.ErrnoException, '', 0));
    };
  }

  private async download(start: string, agent: Agent, signal: AbortSignal, state: { blocked: boolean }): Promise<string> {
    const check = this.opts.check ?? checkPublicUrl;
    let url = start;
    for (let hop = 0; ; hop++) {
      if (!(await check(url)).ok) { state.blocked = true; throw new Stop('blocked'); }
      const res = await request(url, { dispatcher: agent, method: 'GET', headers: HEADERS, signal });
      if (REDIRECTS.has(res.statusCode)) {
        discard(res.body);
        const location = res.headers.location;
        if (hop >= MAX_REDIRECTS || typeof location !== 'string') throw new Stop('failed');
        try { url = new URL(location, url).toString(); } catch { throw new Stop('failed'); }
        continue;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) { discard(res.body); throw new Stop('failed'); }
      const bytes = await readPdfBody(res.body);
      let text: string;
      // pdf.js may take over the bytes it is given, so they are not used after this call.
      try { text = await pdfBufferToText(bytes); } catch { throw new Stop('failed'); }
      if (countLetters(text) < MIN_PDF_LETTERS) throw new Stop('no-text');
      return text;
    }
  }
}

/** The body, at most MAX_PDF_BYTES; stops at once when the first bytes are not `%PDF-`. */
async function readPdfBody(body: AsyncIterable<Buffer> & { on(event: 'error', fn: () => void): unknown; destroy(): void }): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  let checked = false;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > MAX_PDF_BYTES) { discard(body); throw new Stop('too-large'); }
    chunks.push(chunk);
    if (!checked && size >= MAGIC.length) {
      if (Buffer.concat(chunks).subarray(0, MAGIC.length).toString('latin1') !== MAGIC) { discard(body); throw new Stop('not-pdf'); }
      checked = true;
    }
  }
  if (!checked) throw new Stop('not-pdf');
  return new Uint8Array(Buffer.concat(chunks, size));
}

/** Drops a response body without reading it; undici reports the destroy as an error nobody needs to see. */
function discard(body: { on(event: 'error', fn: () => void): unknown; destroy(): void }): void {
  body.on('error', () => undefined);
  body.destroy();
}
