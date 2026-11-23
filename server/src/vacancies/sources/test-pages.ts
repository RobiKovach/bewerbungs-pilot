import { devUpdateSourceAllowed } from '../../updates/updater.js';
import { checkPublicUrl, isPublicAddress, type UrlCheck } from './safe-address.js';

/**
 * End-to-end runs (0.13.0) read fixture pages from a local server: a pasted link, a company site, an Impressum.
 * The page reader normally refuses every internal address, so only in test mode (a throw-away data folder AND fake
 * mail — the same gate as `devUpdateSourceAllowed`) and only with `BP_TEST_PAGES_PORT` set does it read exactly
 * `http://127.0.0.1:<that port>/…` — and then nothing else at all, so a test run never reaches the internet.
 * Outside test mode the variable is ignored and the usual public-address rules apply unchanged.
 */

export interface AddressRules {
  check: (url: string) => Promise<UrlCheck>;
  /** May a page be served from this answering address? */
  addressOk: (ip: string) => boolean;
}

/** The fixture server's port, or null when test pages are off (not test mode, no or a bad port). */
export function testPagesPort(env: NodeJS.ProcessEnv, argv: readonly string[]): number | null {
  if (!devUpdateSourceAllowed(env, argv)) return null;
  const raw = env.BP_TEST_PAGES_PORT;
  if (!raw || !/^\d{1,5}$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1024 && port <= 65535 ? port : null;
}

const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1']);

/** The rules for the page reader: the normal public-address rules, or (test pages on) only the fixture server. */
export function addressRules(port: number | null): AddressRules {
  if (port === null) return { check: (url) => checkPublicUrl(url), addressOk: isPublicAddress };
  return {
    check: async (url) => {
      if (!URL.canParse(url)) return { ok: false, why: 'scheme' };
      const u = new URL(url);
      if (u.username || u.password) return { ok: false, why: 'credentials' };
      return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.port === String(port) ? { ok: true } : { ok: false, why: 'private' };
    },
    addressOk: (ip) => LOOPBACK.has(ip),
  };
}
