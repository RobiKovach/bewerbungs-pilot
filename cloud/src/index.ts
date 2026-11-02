import { handleAdmin, sha256Hex } from './admin.js';
import { readLimited, utf8 } from './body.js';
import { ResendMailer } from './mail.js';
import { D1Store, utcDay, type Mailer, type Store } from './store.js';
import { parseFeedback, parsePing } from './validate.js';

export type { Mailer, Store } from './store.js';

/** ROBERT_EMAIL, RESEND_API_KEY and the optional IP_PEPPER are secrets (`wrangler secret put`), never in code or wrangler.toml. */
export interface Env { DB: D1Database; ROBERT_EMAIL: string; RESEND_API_KEY: string; IP_PEPPER?: string }

export interface Deps { store: Store; mailer: Mailer; now(): number; ipPepper?: string }

const PING_MAX_BYTES = 16 * 1024;
// 5 000 characters can be 20 KB of UTF-8 and more once JSON escapes them.
const FEEDBACK_MAX_BYTES = 64 * 1024;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const FEEDBACK_PER_INSTALL_PER_DAY = 5;
const FEEDBACK_PER_IP_PER_HOUR = 10;
/** Installs never seen before, per IP: a flood of made-up ids can neither inflate the count nor burn D1 writes. */
const NEW_INSTALLS_PER_IP = 20;
/** The window of that cap: IP rows live at most 2 hours (privacy), so the cap cannot look further back. */
const NEW_INSTALLS_WINDOW_MS = 2 * HOUR;
const SUBJECT_TEXT = 60;

const empty = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
const error = (status: number, code: string) =>
  new Response(JSON.stringify({ error: code }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** The body as JSON, or undefined when it is too big or not JSON. */
async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readLimited(req, maxBytes).catch(() => undefined);
  const text = bytes && utf8(bytes);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The IP is only ever kept hashed with the day (and the IP_PEPPER secret, when set), in a rate-limit row ("ip:" key)
 * that lives at most 2 hours.
 */
async function ipKey(req: Request, now: number, purpose: string, pepper = ''): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const salted = pepper ? `${pepper}|${ip}|${utcDay(now)}` : `${ip}|${utcDay(now)}`;
  return `ip:${purpose}:${await sha256Hex(salted)}`;
}

/** One line, no control characters: the subject goes into a mail header. */
const oneLine = (s: string) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim();

async function ping(req: Request, d: Deps): Promise<Response> {
  const input = parsePing(await readJson(req, PING_MAX_BYTES));
  if (!input) return error(400, 'bad_request');
  const now = d.now();
  const today = utcDay(now);
  const last = await d.store.lastPingDay(input.installId);
  // Already counted today: no write at all.
  if (last === today) return empty(204);
  if (last === null) {
    const key = await ipKey(req, now, 'new', d.ipPepper);
    if (await d.store.countHits(key, NEW_INSTALLS_WINDOW_MS, now) >= NEW_INSTALLS_PER_IP) return error(429, 'too_many');
    await d.store.addHit(key, now);
  }
  await d.store.recordPing(input.installId, input.version, today);
  return empty(204);
}

async function feedback(req: Request, d: Deps): Promise<Response> {
  const input = parseFeedback(await readJson(req, FEEDBACK_MAX_BYTES));
  if (!input) return error(400, 'bad_request');
  const now = d.now();
  // Count first, write the hits only for an accepted request: a refused one writes nothing.
  const installKey = `install:${input.installId}:${utcDay(now)}`;
  const ip = await ipKey(req, now, 'feedback', d.ipPepper);
  if (await d.store.countHits(installKey, DAY, now) >= FEEDBACK_PER_INSTALL_PER_DAY
    || await d.store.countHits(ip, HOUR, now) >= FEEDBACK_PER_IP_PER_HOUR) return error(429, 'too_many');
  await d.store.addHit(installKey, now);
  await d.store.addHit(ip, now);

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

/** Everything the worker answers. Only the app's own server calls /v1, so there are no CORS headers. */
export async function handle(req: Request, env: Env, deps: Deps): Promise<Response> {
  const path = new URL(req.url).pathname;
  deps = { ...deps, ipPepper: deps.ipPepper ?? env.IP_PEPPER ?? '' };
  const admin = await handleAdmin(req, path, {
    store: deps.store, mailer: deps.mailer, now: deps.now, adminEmail: env.ROBERT_EMAIL ?? '',
    ipKey: (purpose) => ipKey(req, deps.now(), purpose, deps.ipPepper),
  });
  if (admin) return admin;
  const route = routes[path];
  if (!route) return error(404, 'not_found');
  if (req.method !== 'POST') return error(405, 'method_not_allowed');
  return route(req, deps);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env, { store: new D1Store(env.DB), mailer: new ResendMailer(env.RESEND_API_KEY, env.ROBERT_EMAIL), now: Date.now });
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(new D1Store(env.DB).purge(Date.now()));
  },
} satisfies ExportedHandler<Env>;
