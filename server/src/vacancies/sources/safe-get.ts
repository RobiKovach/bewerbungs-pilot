import dns from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { checkPublicUrl, isPublicAddress, type Lookup } from './safe-address.js';

/**
 * Why a safe GET ended without a body: `blocked` — the link, a redirect or the resolved address is not public (or not
 * an allowed host); `timeout` — the time limit; `tooBig` — more than `maxBytes`; `status` — not 2xx, too many or a bad
 * redirect; `content` — the first bytes are not the expected ones; `network` — anything else (also an abort by the caller).
 */
export type SafeGetWhy = 'blocked' | 'timeout' | 'tooBig' | 'status' | 'content' | 'network';

export class SafeGetError extends Error {
  constructor(readonly why: SafeGetWhy) { super(`safe get: ${why}`); }
}

export type Check = typeof checkPublicUrl;

export interface SafeGetBase {
  signal: AbortSignal;
  /** Tests: a URL check and a DNS resolver / address rule that let a local test server count as public. */
  check?: Check;
  lookup?: Lookup;
  isPublic?: (ip: string) => boolean;
  /** When set, the link and every redirect must stay on exactly these host names (lower case). */
  allowHosts?: readonly string[];
  headers?: Record<string, string>;
}

const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const DEFAULT_HEADERS = { 'user-agent': 'BewerbungsPilot', accept: '*/*' };

const defaultLookup: Lookup = async (host) => (await dns.promises.lookup(host, { all: true })).map((a) => a.address);

/** The DNS step of the connection: every address must be public, else it fails and the request is 'blocked'. */
function pinnedLookup(opts: SafeGetBase, state: { blocked: boolean }): LookupFunction {
  const resolve = opts.lookup ?? defaultLookup;
  const isPublic = opts.isPublic ?? isPublicAddress;
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

const hostAllowed = (url: string, allow: readonly string[] | undefined) => {
  if (!allow) return true;
  try { return allow.includes(new URL(url).hostname.toLowerCase()); } catch { return false; }
};

/**
 * A GET that follows at most 5 redirects; every URL and every redirect passes `check` (and `allowHosts`), and the
 * socket connects only to addresses that pass `isPublic` — the name is resolved once, inside the connection, so a
 * second DNS answer cannot point it elsewhere. Resolves with the 2xx response (its body not read yet).
 * Throws `SafeGetError` ('blocked' | 'status' | 'network'); an abort of `signal` also gives 'network' — the caller
 * tells a cancel from a failure by its own signal.
 */
export async function safeGet(start: string, opts: SafeGetBase): Promise<IncomingMessage> {
  const check = opts.check ?? checkPublicUrl;
  const state = { blocked: false };
  const lookup = pinnedLookup(opts, state);
  const headers = opts.headers ?? DEFAULT_HEADERS;
  let url = start;
  for (let hop = 0; ; hop++) {
    if (!hostAllowed(url, opts.allowHosts) || !(await check(url)).ok) throw new SafeGetError('blocked');
    let res: IncomingMessage;
    try {
      res = await request(url, lookup, headers, opts.signal);
    } catch {
      throw new SafeGetError(state.blocked ? 'blocked' : 'network');
    }
    const status = res.statusCode ?? 0;
    if (REDIRECTS.has(status)) {
      discard(res);
      const location = res.headers.location;
      if (hop >= MAX_REDIRECTS || typeof location !== 'string') throw new SafeGetError('status');
      try { url = new URL(location, url).toString(); } catch { throw new SafeGetError('status'); }
      continue;
    }
    if (status < 200 || status >= 300) { discard(res); throw new SafeGetError('status'); }
    return res;
  }
}

/**
 * The body, at most `maxBytes` (counted — `Content-Length` is not trusted). With `prefix`, stops at once when the
 * first bytes differ ('content'). Throws `SafeGetError` ('tooBig' | 'content' | 'network').
 */
export async function readBody(res: IncomingMessage, opts: { maxBytes: number; prefix?: string }): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  let checked = opts.prefix === undefined;
  try {
    for await (const chunk of res as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > opts.maxBytes) { discard(res); throw new SafeGetError('tooBig'); }
      chunks.push(chunk);
      if (!checked && opts.prefix !== undefined && size >= opts.prefix.length) {
        if (Buffer.concat(chunks).subarray(0, opts.prefix.length).toString('latin1') !== opts.prefix) {
          discard(res);
          throw new SafeGetError('content');
        }
        checked = true;
      }
    }
  } catch (err) {
    if (err instanceof SafeGetError) throw err;
    throw new SafeGetError('network');
  }
  if (!checked) throw new SafeGetError('content');
  return new Uint8Array(Buffer.concat(chunks, size));
}

/**
 * `safeGet` + `readBody` under one time limit for the whole request (redirects and body). Throws `SafeGetError`;
 * 'timeout' when the limit ran out. An abort of `signal` gives 'network' — check your own signal to tell a cancel.
 */
export async function safeGetBytes(url: string, opts: SafeGetBase & { maxBytes: number; timeoutMs: number }): Promise<Uint8Array> {
  if (opts.signal.aborted) throw new SafeGetError('network');
  const stop = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; stop.abort(); }, opts.timeoutMs);
  const onAbort = () => stop.abort();
  opts.signal.addEventListener('abort', onAbort);
  try {
    const res = await safeGet(url, { ...opts, signal: stop.signal });
    return await readBody(res, { maxBytes: opts.maxBytes });
  } catch (err) {
    if (timedOut) throw new SafeGetError('timeout');
    if (err instanceof SafeGetError) throw err;
    throw new SafeGetError('network');
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener('abort', onAbort);
  }
}

/**
 * One GET without a shared agent (no reused connection, so every hop goes through `lookup`); the name is resolved
 * by `lookup` and the socket connects to exactly the address it hands back. TLS still checks the certificate of the name.
 */
function request(url: string, lookup: LookupFunction, headers: Record<string, string>, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = new URL(url).protocol === 'https:' ? https : http;
    const req = lib.request(url, { method: 'GET', headers, lookup, agent: false, signal }, resolve);
    req.on('error', reject);
    req.end();
  });
}

/** Drops a response without reading it (closes its socket); a late error from it is of no interest. */
export function discard(res: IncomingMessage): void {
  res.on('error', () => undefined);
  res.destroy();
}
