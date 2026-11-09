import fs from 'node:fs';
import path from 'node:path';

/**
 * "Starting BewerbungsPilot…" tab (0.12.0). The shortcut (installer/launch.vbs) opens a local page at once and starts
 * the server with a one-time launch code (BP_LAUNCH_CODE). The page asks every port for /launch/<code>/ready.gif;
 * the server that knows the code answers, and the page goes to /launch/<code>, which turns into the session cookie
 * exactly like /open?key=… does. The launch key itself never appears in the page or its file.
 *
 * A code is 64 hex characters (two random GUIDs from Windows, ~244 random bits), works once, and only for
 * CODE_TTL_MS. If the page never comes (another program opens .html files, the browser blocks the local page),
 * the server opens the browser itself after FALLBACK_MS, as before 0.12.0.
 */
export const LAUNCH_CODE = /^[0-9a-f]{64}$/;
export const CODE_TTL_MS = 2 * 60_000;
export const FALLBACK_MS = 10_000;
const MAX_PENDING = 20;

type State = { expires: number; redeemed: boolean };

export class LaunchCodes {
  private readonly codes = new Map<string, State>();

  constructor(private readonly now: () => number = Date.now) {}

  /** A code from the shortcut; anything not shaped like one is ignored (false). */
  register(code: unknown): boolean {
    if (typeof code !== 'string' || !LAUNCH_CODE.test(code)) return false;
    this.prune();
    if (this.codes.size >= MAX_PENDING) return false;
    if (!this.codes.has(code)) this.codes.set(code, { expires: this.now() + CODE_TTL_MS, redeemed: false });
    return true;
  }

  /** Known, unused and not expired: the page may come. */
  pending(code: string): boolean {
    const s = this.codes.get(code);
    return s !== undefined && !s.redeemed && s.expires > this.now();
  }

  /** Uses the code up. True only the first time, within its time. */
  redeem(code: string): boolean {
    if (!this.pending(code)) return false;
    this.codes.get(code)!.redeemed = true;
    return true;
  }

  redeemed(code: string): boolean {
    return this.codes.get(code)?.redeemed === true;
  }

  /** The fallback opened the browser instead: the page must not open a second tab later. */
  cancel(code: string): void {
    const s = this.codes.get(code);
    if (s && !s.redeemed) this.codes.delete(code);
  }

  private prune(): void {
    const t = this.now();
    for (const [code, s] of this.codes) if (s.expires <= t) this.codes.delete(code);
  }
}

/** Waits until the page used the code, or the time is up. */
export async function waitForRedeem(isRedeemed: () => boolean | Promise<boolean>, timeoutMs = FALLBACK_MS, stepMs = 200): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try { if (await isRedeemed()) return true; } catch { /* asked again on the next step */ }
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** A 1×1 transparent GIF: the page only needs `onload`. */
export const READY_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Where the shortcut writes its "Starting…" pages: <data>\tmp\launch\starting-<first 16 of the code>.html. */
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
