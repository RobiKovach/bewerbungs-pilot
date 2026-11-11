import type { ResearchNews, ResearchSource, VacancyContact } from '@bp/shared';
import { AppError } from '../errors.js';
import { isAaHost } from '../vacancies/aa-links.js';
import type { PageLink, PageReader, ReadSession } from '../vacancies/sources/page-reader.js';
import { contactFromPages, type FoundPage } from './contact-merge.js';
import { nameOnPage, nextPages, siteOf, websiteCandidates, type PageKind } from './links.js';
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
  news: ResearchNews[] | null;
  sources: ResearchSource[];
}
export interface CollectDeps { reader: PageReader; fetchNews: typeof FetchNews; now: () => Date }

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
  const fromLinks = page.links
    .filter((l) => l.href.toLowerCase().startsWith('mailto:'))
    .map((l) => decodeURIComponent(l.href.slice(7).split('?')[0] ?? ''));
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

  // News run beside the page reading; a rejection (only LLM_CANCELLED) is held until it is awaited.
  const newsTask: Promise<ResearchNews[] | null> | null = mode === 'full' ? deps.fetchNews(input.company, signal) : null;
  newsTask?.catch(() => undefined);

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
        if (!c.nameCheck || (home && nameOnPage(input.company, home.text))) { website = c.url; break; }
        if (home) pages.splice(pages.indexOf(home), 1); // a rejected guess is neither a source nor a contact page
      }
    }

    // 3. Impressum → contact → apply → careers → about, one page of each kind.
    const seenKinds = new Set<PageKind>(pages.map((p) => p.kind));
    for (;;) {
      if (!canOpen()) break;
      const links = pages.flatMap((p) => p.links);
      const next = nextPages(website, links, opened).find((n) => !seenKinds.has(n.kind));
      if (!next) break;
      seenKinds.add(next.kind);
      await open(next.url, next.kind);
    }

    const news = newsTask ? await newsTask : null;
    if (signal.aborted) throw cancelled();
    const sources: ResearchSource[] = [
      ...pages.map((p) => ({ url: p.url, kind: p.kind })),
      ...(news ?? []).map((n) => ({ url: n.url, kind: 'news' as const })),
    ];
    return { website, pages, contact: contactFromPages(pages, siteOf(website)), news, sources };
  } finally {
    await session?.close().catch(() => undefined);
  }
}
