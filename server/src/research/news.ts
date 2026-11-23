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
  const xml = new TextDecoder().decode(bytes);
  // A 200 that is not a feed (Google's consent or "unusual traffic" page) means the news could not be fetched.
  if (!/<rss[\s>]/.test(xml) || !/<channel[\s>][\s\S]*<\/channel>/.test(xml)) return null;
  return parseNewsRss(xml, new Date());
}

/**
 * Google News is OFF until Robert decides (0.13.0, task 12, Ruling R38): every feed says it "is made available
 * solely for the purpose of rendering Google News results within a personal feed reader for personal, non-commercial
 * use. Any other use of the feed is expressly prohibited." — a summary by an AI helper inside an app is not clearly
 * that. While off, nothing is asked (the company name never leaves the PC for news) and the block says the news
 * could not be loaded. Turning it on: set this to true and update privacy.html / README.
 */
export const NEWS_ENABLED = false;

/** The news source the app uses outside test mode. */
export function newsSource(): typeof fetchNews {
  return NEWS_ENABLED ? fetchNews : async (_company, signal) => {
    if (signal.aborted) throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
    return null;
  };
}

/**
 * Test mode (Ruling R3, same gate as a development update source: a throw-away data folder and fake mail): a fixed
 * list instead of Google News, so an end-to-end run never reaches the network. Two items, dated 10 and 40 days back.
 */
export async function fakeNews(company: string, signal: AbortSignal): Promise<ResearchNews[] | null> {
  if (signal.aborted) throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
  if (!newsQueryUrl(company)) return null;
  const day = (back: number) => new Date(Date.now() - back * DAY_MS).toISOString().slice(0, 10);
  return [
    { title: `${coreName(company)} eröffnet neuen Standort (Testmeldung)`, date: day(10), source: 'Testquelle', url: 'https://news.example.invalid/1' },
    { title: `${coreName(company)} stellt neues Produkt vor (Testmeldung)`, date: day(40), source: 'Testquelle', url: 'https://news.example.invalid/2' },
  ];
}
