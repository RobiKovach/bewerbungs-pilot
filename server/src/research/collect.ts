import type { ResearchNews, ResearchSource, VacancyContact } from '@bp/shared';
import { AppError } from '../errors.js';
import { isAaHost } from '../vacancies/aa-links.js';
import type { PageLink, PageReader, ReadSession } from '../vacancies/sources/page-reader.js';
import { contactFromPages, mailtoAddress, type FoundPage } from './contact-merge.js';
import { nameOnPage, nextPages, oneWordNameShown, siteOf, websiteCandidates, type PageKind } from './links.js';
import type { fetchNews as FetchNews } from './news.js';

/**
 * One company research run (0.13.0, spec 4.2): the program — never the AI — reads the vacancy page, finds and checks
 * the company's own site, follows its Impressum / contact / job pages and, in `full` mode, asks Google News. One
 * browser session for everything, at most `MAX_PAGES` opened pages and `COLLECT_BUDGET_MS`. A page that cannot be
 * read is skipped (no error); the page texts live only in the returned value.
 */

export type CollectMode = 'contact' | 'full';
export interface CollectInput {
  /** '' when the vacancy was pasted as text. */
  vacancyUrl: string;
  partnerUrl: string;
  company: string;
  /** The company site the person typed, or ''. Used without a name check. */
  websiteHint: string;
  /** Arbeitsagentur: its page is behind a captcha, so the partner page (if any) is read instead (Ruling R6). */
  skipVacancyPage: boolean;
}
export interface Collected {
  website: string;
  pages: FoundPage[];
  contact: VacancyContact;
  /** null: news were asked but could not be read. */
  news: ResearchNews[] | null;
  /** News are off (`fetchNews` null): nothing was asked, the card shows no news section at all. */
  newsOff?: boolean;
  sources: ResearchSource[];
}
/** `fetchNews` null = news off (0.13.0, Robert 2026-11-23): no news service is ever asked. */
export interface CollectDeps { reader: PageReader; fetchNews: typeof FetchNews | null; now: () => Date }

export const MAX_PAGES = 6;
export const COLLECT_BUDGET_MS = 60_000;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const cancelled = () => new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');

/** Links without a login (`user:pass@`) — such a link is never opened nor passed on (parked M3 of Task 2). */
function safeLinks(links: PageLink[]): PageLink[] {
  return links.filter((l) => {
    if (!URL.canParse(l.href)) return false;
    const u = new URL(l.href);
    return u.username === '' && u.password === '';
  });
}

function emailsOf(page: FoundPage): string[] {
  // The same safe reading as the contact (a malformed `%..` never throws; a list gives its first address).
  const fromLinks = page.links.filter((l) => /^mailto:/i.test(l.href)).map((l) => mailtoAddress(l.href));
  return [...new Set([...fromLinks, ...(page.text.match(EMAIL) ?? [])].map((e) => e.trim().toLowerCase()).filter((e) => e))];
}

/** The site to open for a typed address: scheme added when missing, only http(s) without a login; '' otherwise. */
function hintUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return siteOf(url) ? url : '';
}

export async function collect(input: CollectInput, mode: CollectMode, deps: CollectDeps, signal: AbortSignal): Promise<Collected> {
  if (signal.aborted) throw cancelled();
  const deadline = deps.now().getTime() + COLLECT_BUDGET_MS;

  // News run beside the page reading, but only once a browser exists (no browser → nothing leaves the PC), under
  // their own signal: when the research ends — fine or not — a still running news request is stopped.
  const newsStop = new AbortController();
  const stopNews = () => newsStop.abort();
  signal.addEventListener('abort', stopNews, { once: true });
  let newsTask: Promise<ResearchNews[] | null> | null = null;

  const pages: FoundPage[] = [];
  const opened = new Set<string>();
  let attempts = 0;
  let outOfTime = false;
  let session: ReadSession | null = null;

  const canOpen = () => !outOfTime && attempts < MAX_PAGES && deps.now().getTime() < deadline;

  /** Opens one page; null when it cannot be read (skipped) or the budget is spent. */
  const open = async (url: string, kind: PageKind): Promise<FoundPage | null> => {
    if (signal.aborted) throw cancelled();
    if (!session || !canOpen() || opened.has(url)) return null;
    opened.add(url);
    attempts += 1;
    try {
      const read = await session.open(url);
      if (signal.aborted) throw cancelled();
      if (read.url) opened.add(read.url); // a redirect target is never opened again
      const page: FoundPage = { url: read.url || url, kind, text: read.text, links: safeLinks(read.links) };
      pages.push(page);
      return page;
    } catch (err) {
      if (signal.aborted) throw cancelled();
      if (err instanceof AppError) {
        if (err.code === 'LLM_CANCELLED' || err.code === 'BROWSER_MISSING') throw err;
        if (err.reason === 'pageUnreadable' && err.detailsForLog.endsWith('timeout')) outOfTime = true;
      }
      return null;
    }
  };

  let website = '';
  try {
    session = await deps.reader.session(signal, deadline);
    if (mode === 'full' && deps.fetchNews) {
      newsTask = deps.fetchNews(input.company, newsStop.signal);
      newsTask.catch(() => undefined); // held until awaited below; never an unhandled rejection
    }

    // 1. The vacancy page — or, for Arbeitsagentur, the employer's partner page.
    let firstUrl = '';
    if (input.vacancyUrl && !input.skipVacancyPage) firstUrl = input.vacancyUrl;
    else if (input.partnerUrl && !isAaHost(input.partnerUrl)) firstUrl = input.partnerUrl;
    const first = firstUrl ? await open(firstUrl, 'vacancy') : null;

    // 2. The company's own site.
    const hint = hintUrl(input.websiteHint);
    if (hint) {
      website = new URL(hint).origin;
      if (siteOf(website) !== siteOf(firstUrl)) await open(website, 'home');
    } else {
      const candidates = websiteCandidates({
        pageUrl: firstUrl, links: first?.links ?? [], emails: first ? emailsOf(first) : [], company: input.company,
      });
      for (const c of candidates) {
        if (!canOpen()) break;
        // The vacancy page is on that site already: use its real address (`www.` or not) and do not open it twice.
        if (first && siteOf(c.url) === siteOf(first.url)) { website = new URL(first.url).origin; break; }
        const home = await open(c.url, 'home');
        // The site is where the home page landed: a guess may redirect (www.isax.de → www.isax.com, Ruling R46).
        const landed = home ? new URL(home.url).origin : c.url;
        if (!c.nameCheck || (home && nameOnPage(input.company, home.text))) { website = landed; break; }
        // A one-word name ("iSAX") on a home page without legal form: the site's own Impressum may confirm it (R43).
        const imprint = home && oneWordNameShown(input.company, home.text)
          ? nextPages(landed, home.links, opened).find((n) => n.kind === 'impressum') : undefined;
        const imp = imprint ? await open(imprint.url, 'impressum') : null;
        if (home && imp && nameOnPage(input.company, imp.text)) { website = landed; break; }
        // A rejected guess is neither a source nor a contact page.
        for (const p of [imp, home]) if (p) pages.splice(pages.indexOf(p), 1);
      }
    }

    // 3. Impressum → contact → apply → careers → about, one page of each kind.
    const seenKinds = new Set<PageKind>(pages.map((p) => p.kind));
    for (;;) {
      if (!canOpen()) break;
      const links = pages.flatMap((p) => p.links);
      const next = nextPages(website, links, opened).find((n) => !seenKinds.has(n.kind));
      if (!next) break;
      // A kind counts as done only when its page was read: a broken first Impressum link leaves room for a second.
      if (await open(next.url, next.kind)) seenKinds.add(next.kind);
    }

    const news = newsTask ? await newsTask : null;
    if (signal.aborted) throw cancelled();
    const sources: ResearchSource[] = [
      ...pages.map((p) => ({ url: p.url, kind: p.kind })),
      ...(news ?? []).map((n) => ({ url: n.url, kind: 'news' as const })),
    ];
    return { website, pages, contact: contactFromPages(pages, siteOf(website)), news, ...(deps.fetchNews ? {} : { newsOff: true }), sources };
  } finally {
    signal.removeEventListener('abort', stopNews);
    newsStop.abort();
    await session?.close().catch(() => undefined);
  }
}
