import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * "Starting BewerbungsPilot…" tab (0.12.0). The shortcut (installer/launch.vbs) opens a local page at once and starts
 * the server with a one-time launch code (BP_LAUNCH_CODE). The launch key itself never appears in the page or its file.
 *
 * The page cannot know the server's port (4280–4299), and any program on this PC may listen on a free port in that
 * range, so the page never sends the secret part of the code to a port that has not proven it knows the code:
 *   code (64 hex, two random Windows GUIDs) = probe P (16 hex, also the page's file name) + proof Q (6 hex) + secret S (42 hex)
 *   1. The page asks every port for /launch/<P>/ready.svg.
 *   2. The server that knows P answers with an image whose size encodes Q (width = 1 + Q>>12, height = 1 + Q&0xfff).
 *      Q itself is never sent by the page; a port answering with any other size is dropped (one 1-in-2^24 guess).
 *   3. Only then the page goes to /launch/<P><S> on that port, which turns into the session cookie exactly like
 *      /open?key=… does: once, and only within CODE_TTL_MS.
 * A code the server no longer accepts (used, or cancelled by the fallback) answers with CLOSED_SIZE, so the page can
 * say at once that the app already opened elsewhere.
 *
 * If the page never comes (another program opens .html files, the browser blocks the local page), the server opens the
 * browser itself after FALLBACK_MS, as before 0.12.0; a page that was seen gets SEEN_GRACE_MS more to arrive.
 */
export const LAUNCH_CODE = /^[0-9a-f]{64}$/;
export const LAUNCH_PROBE = /^[0-9a-f]{16}$/;
export const LAUNCH_TOKEN = /^[0-9a-f]{58}$/;
export const CODE_TTL_MS = 2 * 60_000;
export const FALLBACK_MS = 10_000;
export const SEEN_GRACE_MS = 5_000;
export const CLOSED_SIZE = { width: 4100, height: 1 } as const;
const MAX_PENDING = 20;

const probeOf = (code: string) => code.slice(0, 16);
const proofOf = (code: string) => parseInt(code.slice(16, 22), 16);
const secretOf = (code: string) => code.slice(22);

/** The image size that proves the server knows the code (both sides at most 4096). */
export function proofSize(code: string): { width: number; height: number } {
  const q = proofOf(code);
  return { width: 1 + (q >> 12), height: 1 + (q & 0xfff) };
}

type State = { code: string; expires: number; state: 'pending' | 'redeemed' | 'cancelled'; seen: boolean };

export class LaunchCodes {
  /** By probe P: the page's first request names only P. */
  private readonly codes = new Map<string, State>();

  constructor(private readonly now: () => number = Date.now) {}

  /** A code from the shortcut; anything not shaped like one is ignored (false). */
  register(code: unknown): boolean {
    if (typeof code !== 'string' || !LAUNCH_CODE.test(code)) return false;
    this.prune();
    const known = this.codes.get(probeOf(code));
    if (known) return known.code === code;
    if (this.codes.size >= MAX_PENDING) return false;
    this.codes.set(probeOf(code), { code, expires: this.now() + CODE_TTL_MS, state: 'pending', seen: false });
    return true;
  }

  private live(probe: string): State | undefined {
    const s = this.codes.get(probe);
    return s && s.expires > this.now() ? s : undefined;
  }

  /** Step 1–2: what the page's image request gets. Null = unknown here (404). */
  probe(probe: string): { width: number; height: number } | null {
    const s = this.live(probe);
    if (!s) return null;
    if (s.state !== 'pending') return CLOSED_SIZE;
    s.seen = true;
    return proofSize(s.code);
  }

  /** Step 3: P + S. Uses the code up; true only the first time, within its time. */
  redeem(token: string): boolean {
    if (!LAUNCH_TOKEN.test(token)) return false;
    const s = this.live(token.slice(0, 16));
    if (!s || s.state !== 'pending') return false;
    const given = Buffer.from(token.slice(16));
    const want = Buffer.from(secretOf(s.code));
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return false;
    s.state = 'redeemed';
    return true;
  }

  redeemed(code: string): boolean {
    const s = this.codes.get(probeOf(code));
    return s?.code === code && s.state === 'redeemed';
  }

  /** The page asked for its image: it is open and may come in a moment. */
  seen(code: string): boolean {
    const s = this.codes.get(probeOf(code));
    return s?.code === code && s.seen;
  }

  /** The fallback opened the browser instead: the page must not open a second tab later. */
  cancel(code: string): void {
    const s = this.codes.get(probeOf(code));
    if (s?.code === code && s.state === 'pending') s.state = 'cancelled';
  }

  private prune(): void {
    const t = this.now();
    for (const [p, s] of this.codes) if (s.expires <= t) this.codes.delete(p);
  }
}

/**
 * Waits until the page used the code. Gives up after `timeoutMs`, or after `timeoutMs + graceMs` when the page already
 * asked for its image by then (a slow browser should not end up with two tabs).
 */
export async function waitForRedeem(
  isRedeemed: () => boolean | Promise<boolean>,
  o: { timeoutMs?: number; graceMs?: number; seen?: () => boolean | Promise<boolean>; stepMs?: number } = {},
): Promise<boolean> {
  const { timeoutMs = FALLBACK_MS, graceMs = SEEN_GRACE_MS, seen, stepMs = 200 } = o;
  const start = Date.now();
  let end = start + timeoutMs;
  let extended = false;
  for (;;) {
    try { if (await isRedeemed()) return true; } catch { /* asked again on the next step */ }
    if (Date.now() >= end) {
      let wasSeen = false;
      try { wasSeen = !extended && seen !== undefined && await seen(); } catch { /* not seen */ }
      if (!wasSeen) return false;
      extended = true;
      end += graceMs;
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** An image of the given size (the page reads only naturalWidth/naturalHeight). */
export const sizedSvg = (s: { width: number; height: number }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${s.width}" height="${s.height}"/>`;

/** Where the shortcut writes its "Starting…" pages: <data>\tmp\launch\starting-<P>.html. */
export const LAUNCH_PAGE = /^starting-[0-9a-f]{16}\.html$/;

/**
 * The page is read by the browser right after the shortcut writes it, so a minute later it is no longer needed.
 * Only files named like the shortcut's pages are touched; errors (a file still open) are left for the next start.
 */
export function removeOldLaunchPages(dir: string, olderThanMs = 60_000, now = Date.now()): void {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!LAUNCH_PAGE.test(name)) continue;
    const file = path.join(dir, name);
    try { if (now - fs.statSync(file).mtimeMs >= olderThanMs) fs.rmSync(file, { force: true }); } catch { /* next start */ }
  }
}
