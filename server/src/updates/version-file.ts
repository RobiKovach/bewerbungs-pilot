import type { Language } from '@bp/shared';
import { SUPPORTED_LANGUAGES } from '../data/settings.js';

/** Our own file on GitHub Pages (docs/version.json), not the GitHub API: no rate limit, a format we control. */
export const UPDATE_URL = 'https://robikovach.github.io/bewerbungs-pilot/version.json';

/** Only links to our own GitHub releases are ever shown — a broken site cannot slip someone a foreign link. */
const RELEASES_PREFIX = 'https://github.com/RobiKovach/bewerbungs-pilot/releases/';
const SEMVER = /^\d+\.\d+\.\d+$/;
const MAX_NOTES = 300;
const MAX_URL = 500;

export interface VersionFile {
  schema: 1;
  latest: string;
  released: string;
  url: string;
  notes: Partial<Record<Language, string>>;
}

/** The version file as published, or null when anything about it is wrong. Notes stay plain text (React escapes them). */
export function parseVersionFile(raw: unknown): VersionFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.schema !== 1) return null;
  if (typeof r.latest !== 'string' || !SEMVER.test(r.latest)) return null;
  const url = releaseUrl(r.url);
  if (url === null) return null;
  const notes: Partial<Record<Language, string>> = {};
  if (r.notes && typeof r.notes === 'object' && !Array.isArray(r.notes)) {
    const n = r.notes as Record<string, unknown>;
    for (const lang of SUPPORTED_LANGUAGES) {
      const text = n[lang];
      if (typeof text === 'string') notes[lang] = Array.from(text).slice(0, MAX_NOTES).join('');
    }
  }
  return { schema: 1, latest: r.latest, released: typeof r.released === 'string' ? r.released.slice(0, 40) : '', url, notes };
}

/** The url only if it is, also after URL normalisation (`..`, odd hosts), one of our release pages. */
function releaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_URL || !raw.startsWith(RELEASES_PREFIX)) return null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  return parsed.href === raw && parsed.href.startsWith(RELEASES_PREFIX) ? raw : null;
}

/** a > b for plain `x.y.z` versions; anything else is never newer. */
export function isNewer(a: string, b: string): boolean {
  if (!SEMVER.test(a) || !SEMVER.test(b)) return false;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! > pb[i]!;
  }
  return false;
}
