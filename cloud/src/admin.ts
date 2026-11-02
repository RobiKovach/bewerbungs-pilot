import { dashboardPage, loginPage } from './admin-page.js';
import type { Mailer, Store } from './store.js';
import { utcDay } from './store.js';

export const COOKIE = 'bp_admin';
export const CODE_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 12 * 3600_000;
export const MAX_WRONG_CODES = 5;
/** Code requests per IP per hour (counted for any address), and code mails per day in total. */
export const CODE_REQUESTS_PER_IP_PER_HOUR = 5;
export const CODE_MAILS_PER_DAY = 20;
const FEEDBACK_SHOWN = 500;
const FORM_MAX_BYTES = 4 * 1024;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export const ADMIN_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export interface AdminDeps {
  store: Store;
  mailer: Mailer;
  now(): number;
  /** The admin address (ROBERT_EMAIL secret). Empty = nobody can sign in. */
  adminEmail: string;
  /** "ip:<purpose>:<hash>" — the IP is only ever kept hashed with the day. */
  ipKey(purpose: string): Promise<string>;
}

const html = (status: number, body: string, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...ADMIN_HEADERS, 'content-type': 'text/html; charset=utf-8', ...extra } });

const redirect = (cookie: string) => new Response(null, { status: 303, headers: { ...ADMIN_HEADERS, location: '/admin', 'set-cookie': cookie } });

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Equal-length hex strings compared without an early exit. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Six digits, uniformly (rejection sampling, no modulo bias). */
export function newCode(): string {
  const limit = 2 ** 32 - (2 ** 32 % 1_000_000);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return String(buf[0]! % 1_000_000).padStart(6, '0');
  }
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const normEmail = (s: string) => s.trim().toLowerCase();

/** A small form body (urlencoded from the page, JSON accepted too); null when too big or unreadable. */
async function readForm(req: Request): Promise<Record<string, string> | null> {
  const text = await req.text().catch(() => null);
  if (text === null || new TextEncoder().encode(text).byteLength > FORM_MAX_BYTES) return null;
  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      const v = JSON.parse(text) as unknown;
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
      return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'));
    } catch {
      return null;
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function sessionToken(req: Request): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=') || null;
  }
  return null;
}

async function signedIn(req: Request, d: AdminDeps): Promise<string | null> {
  const token = sessionToken(req);
  if (!token) return null;
  const hash = await sha256Hex(token);
  return (await d.store.hasSession(hash, d.now())) ? hash : null;
}

const SENT_MESSAGE = 'If this is the admin address, a code is on its way. It is valid for 10 minutes.';

async function requestCode(req: Request, d: AdminDeps): Promise<Response> {
  const form = await readForm(req);
  if (!form) return html(400, loginPage('email', 'Please enter an e-mail address.'));
  const now = d.now();
  const ipKey = await d.ipKey('admincode');
  if (await d.store.countHits(ipKey, HOUR, now) >= CODE_REQUESTS_PER_IP_PER_HOUR) {
    return html(429, loginPage('email', 'Too many requests. Try again in an hour.'));
  }
  await d.store.addHit(ipKey, now);
  const mailsKey = `admin:mails:${utcDay(now)}`;
  // The same answer for every address: the page never tells whether an address is the admin's.
  if (d.adminEmail && normEmail(form.email ?? '') === normEmail(d.adminEmail)
    && await d.store.countHits(mailsKey, DAY, now) < CODE_MAILS_PER_DAY) {
    const code = newCode();
    await d.store.saveCode(await sha256Hex(code), now + CODE_TTL_MS);
    await d.store.addHit(mailsKey, now);
    await d.mailer.send({
      subject: 'BewerbungsPilot admin code',
      text: `Your sign-in code: ${code}\n\nIt is valid for 10 minutes and works once. If you did not ask for it, ignore this mail.`,
    }).catch(() => false);
  }
  return html(200, loginPage('code', SENT_MESSAGE));
}

async function login(req: Request, d: AdminDeps): Promise<Response> {
  const form = await readForm(req);
  const now = d.now();
  const stored = await d.store.getCode();
  if (!stored || stored.expires <= now) {
    return html(401, loginPage('email', 'The code has expired or was already used. Ask for a new one.'));
  }
  if (stored.attempts >= MAX_WRONG_CODES) {
    await d.store.deleteCode();
    return html(429, loginPage('email', 'Too many wrong codes. Ask for a new one.'));
  }
  const typed = (form?.code ?? '').trim();
  if (/^\d{6}$/.test(typed) && sameHex(await sha256Hex(typed), stored.hash)) {
    await d.store.deleteCode();
    const token = newToken();
    await d.store.addSession(await sha256Hex(token), now + SESSION_TTL_MS);
    return redirect(`${COOKIE}=${token}; Path=/admin; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Strict`);
  }
  await d.store.countCodeAttempt();
  return html(401, loginPage('code', 'Wrong code.'));
}

async function logout(req: Request, d: AdminDeps): Promise<Response> {
  const token = sessionToken(req);
  if (token) await d.store.deleteSession(await sha256Hex(token));
  return redirect(`${COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

async function show(req: Request, d: AdminDeps): Promise<Response> {
  if (!(await signedIn(req, d))) return html(200, loginPage('email'));
  const now = d.now();
  return html(200, dashboardPage(await d.store.stats(now), await d.store.listFeedback(FEEDBACK_SHOWN)));
}

const routes: Record<string, { method: string; run: (req: Request, d: AdminDeps) => Promise<Response> }> = {
  '/admin': { method: 'GET', run: show },
  '/admin/code': { method: 'POST', run: requestCode },
  '/admin/login': { method: 'POST', run: login },
  '/admin/logout': { method: 'POST', run: logout },
};

/** The admin pages, or null when the path is not one of them. */
export async function handleAdmin(req: Request, path: string, d: AdminDeps): Promise<Response | null> {
  const route = routes[path];
  if (!route) return null;
  if (req.method !== route.method) return html(405, 'Method not allowed', { allow: route.method });
  return route.run(req, d);
}
