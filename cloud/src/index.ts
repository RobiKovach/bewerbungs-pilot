import { D1Store, utcDay, type Mailer, type Store } from './store.js';
import { parseFeedback, parsePing } from './validate.js';

export type { Mailer, Store } from './store.js';

/** Grows in Task 2 (ROBERT_EMAIL, RESEND_API_KEY). */
export interface Env { DB: D1Database }

export interface Deps { store: Store; mailer: Mailer; now(): number }

const PING_MAX_BYTES = 16 * 1024;
// 5 000 characters can be 20 KB of UTF-8 and more once JSON escapes them.
const FEEDBACK_MAX_BYTES = 64 * 1024;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const FEEDBACK_PER_INSTALL_PER_DAY = 5;
const FEEDBACK_PER_IP_PER_HOUR = 10;
const SUBJECT_TEXT = 60;

const empty = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
const error = (status: number, code: string) =>
  new Response(JSON.stringify({ error: code }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** The body as JSON, or undefined when it is too big or not JSON. Reads the stream, never trusts Content-Length. */
async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  if (!req.body) return undefined;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return undefined;
  }
}

/** The IP is only ever kept hashed with the day, in a rate-limit row that lives at most 2 hours. */
async function ipKey(req: Request, now: number): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${utcDay(now)}`));
  return `ip:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** One line, no control characters: the subject goes into a mail header. */
const oneLine = (s: string) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim();

async function ping(req: Request, d: Deps): Promise<Response> {
  const input = parsePing(await readJson(req, PING_MAX_BYTES));
  if (!input) return error(400, 'bad_request');
  await d.store.recordPing(input.installId, input.version, utcDay(d.now()));
  return empty(204);
}

async function feedback(req: Request, d: Deps): Promise<Response> {
  const input = parseFeedback(await readJson(req, FEEDBACK_MAX_BYTES));
  if (!input) return error(400, 'bad_request');
  const now = d.now();
  const perInstall = await d.store.hit(`install:${input.installId}:${utcDay(now)}`, DAY, now);
  const perIp = await d.store.hit(await ipKey(req, now), HOUR, now);
  if (perInstall > FEEDBACK_PER_INSTALL_PER_DAY || perIp > FEEDBACK_PER_IP_PER_HOUR) return error(429, 'too_many');

  const createdAt = new Date(now).toISOString();
  const id = await d.store.addFeedback({
    createdAt, version: input.version, language: input.language, kind: input.kind, email: input.email, text: input.text,
  });
  const kind = input.kind === 'problem' ? 'Problem' : 'Idea';
  const ok = await d.mailer.send({
    subject: `BewerbungsPilot ${input.version}: ${kind} — ${Array.from(oneLine(input.text)).slice(0, SUBJECT_TEXT).join('')}`,
    text: [
      input.text, '', '—', `From: ${input.email}`, `Version: ${input.version}`, `Language: ${input.language}`, `Kind: ${kind}`, `Date: ${createdAt}`,
    ].join('\n'),
    replyTo: input.email,
  }).catch(() => false);
  await d.store.markMailed(id, ok);
  return empty(202);
}

const routes: Record<string, (req: Request, d: Deps) => Promise<Response>> = { '/v1/ping': ping, '/v1/feedback': feedback };

/** Everything the worker answers. Only the app's own server calls it, so there are no CORS headers. */
export async function handle(req: Request, _env: Env, deps: Deps): Promise<Response> {
  const route = routes[new URL(req.url).pathname];
  if (!route) return error(404, 'not_found');
  if (req.method !== 'POST') return error(405, 'method_not_allowed');
  return route(req, deps);
}

/** Until Task 2 brings the Resend mailer, feedback is only stored (mailed = 0). */
const noMailer: Mailer = { send: async () => false };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env, { store: new D1Store(env.DB), mailer: noMailer, now: Date.now });
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(new D1Store(env.DB).purge(Date.now()));
  },
} satisfies ExportedHandler<Env>;
