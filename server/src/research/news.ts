import type { ResearchNews } from '@bp/shared';
import { AppError } from '../errors.js';
import { safeGetBytes } from '../vacancies/sources/safe-get.js';
import { companySlugs, coreName } from './links.js';

const NEWS_HOST = 'news.google.com';
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_AGE_DAYS = 180;
const MAX_ITEMS = 10;
const DAY_MS = 86_400_000;

/**
 * The Google News RSS search for the company (spec 4.2 step 4): its name without the legal form, in quotes, last
 * ~6 months, German edition. `null` for an empty, generic or too short name — then nothing is asked at all.
 */
export function newsQueryUrl(company: string): string | null {
  if (companySlugs(company).length === 0) return null;
  const q = encodeURIComponent(`"${coreName(company)}"`);
  return `https://${NEWS_HOST}/rss/search?q=${q}+when:${MAX_AGE_DAYS}d&hl=de&gl=DE&ceid=DE:de`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** The text of one tag: CDATA as is, otherwise the five XML entities decoded (once — "&amp;lt;" stays "&lt;"). */
function decode(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  if (cdata) return cdata[1].trim();
  return raw.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ENTITIES[e]).trim();
}

const tag = (item: string, name: string) => {
  const m = new RegExp(String.raw`<${name}(?:\s[^>]*)?>([\s\S]*?)</${name}>`).exec(item);
  return m ? decode(m[1]) : '';
};

const isHttp = (url: string) => { try { return /^https?:$/.test(new URL(url).protocol); } catch { return false; } };

/**
 * The news of a Google News RSS answer: title, date (YYYY-MM-DD), source and link of each `<item>`; only items of
 * the last 180 days with a date, a title and an http(s) link; newest first, at most 10. No XML library: the feed is
 * flat and only these four tags are read.
 */
export function parseNewsRss(xml: string, now: Date): ResearchNews[] {
  const oldest = now.getTime() - MAX_AGE_DAYS * DAY_MS;
  const found: { news: ResearchNews; at: number }[] = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)) {
    const item = m[1];
    const title = tag(item, 'title');
    const url = tag(item, 'link');
    const at = Date.parse(tag(item, 'pubDate'));
    if (!title || !isHttp(url) || Number.isNaN(at) || at < oldest) continue;
    found.push({ at, news: { title, date: new Date(at).toISOString().slice(0, 10), source: tag(item, 'source'), url } });
  }
  return found.sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS).map((f) => f.news);
}

/**
 * Recent news about the company from Google News (only `news.google.com`, ≤ 1 MB, 10 s, through the pinned safe
 * fetcher; only the company name leaves the PC). `null` when there is no usable name or the request failed — never
 * throws, except `LLM_CANCELLED` when `signal` aborts.
 */
export async function fetchNews(
  company: string, signal: AbortSignal, get: typeof safeGetBytes = safeGetBytes,
): Promise<ResearchNews[] | null> {
  const cancelled = () => new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
  if (signal.aborted) throw cancelled();
  const url = newsQueryUrl(company);
  if (!url) return null;
  let bytes: Uint8Array;
  try {
    bytes = await get(url, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, signal, allowHosts: [NEWS_HOST] });
  } catch {
    // A failed request (blocked, timeout, too big, network) only means "no news" — never an error for the person.
    if (signal.aborted) throw cancelled();
    return null;
  }
  if (signal.aborted) throw cancelled();
  return parseNewsRss(new TextDecoder().decode(bytes), new Date());
}
