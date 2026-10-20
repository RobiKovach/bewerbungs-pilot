import crypto from 'node:crypto';

/** A fresh key on every start: whoever can read server.json (only this Windows user) can open the app. */
export function newLaunchKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Constant-time comparison; an empty or missing key never matches. */
export function keyMatches(given: string | undefined, key: string): boolean {
  if (!given || !key) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Cookies do not tell ports apart, so a copy on another port (e.g. a test copy on 4281) needs its own name. */
export function cookieName(port: number): string {
  return `bp_key_${port}`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** The address the shortcut opens: /open turns the key into a cookie and goes on to the app. */
export function openUrl(host: string, port: number, key: string): string {
  return `http://${host}:${port}/open?key=${encodeURIComponent(key)}`;
}
