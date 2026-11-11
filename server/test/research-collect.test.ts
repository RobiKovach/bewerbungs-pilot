import { describe, expect, it, vi } from 'vitest';
import type { ResearchNews } from '@bp/shared';
import { AppError } from '../src/errors.js';
import { COLLECT_BUDGET_MS, MAX_PAGES, collect, type CollectInput } from '../src/research/collect.js';
import type { fetchNews } from '../src/research/news.js';
import type { PageRead, PageReader } from '../src/vacancies/sources/page-reader.js';

const NOW = new Date('2026-11-11T10:00:00Z');
const key = (url: string) => url.replace(/\/$/, '');

type Site = Record<string, PageRead | 'fail'>;

/** A fake reader: URL → page; every `open` moves the fake clock by `stepMs`. */
function fakeReader(site: Site, opts: { stepMs?: number; onOpen?: (url: string) => void } = {}) {
  let now = NOW.getTime();
  const opened: string[] = [];
  const close = vi.fn(async () => undefined);
  const deadlines: number[] = [];
  const reader: PageReader = {
    read: async () => { throw new Error('not used'); },
    session: async (_signal, deadlineMs) => {
      deadlines.push(deadlineMs);
      return {
        open: async (url: string) => {
          opened.push(url);
          opts.onOpen?.(url);
          now += opts.stepMs ?? 1000;
          const page = site[key(url)];
          if (!page || page === 'fail') throw new AppError('BAD_REQUEST', 'page not readable: failed', 'pageUnreadable');
          return page;
        },
        close,
      };
    },
  };
  return { reader, opened, close, deadlines, clock: () => new Date(now) };
}

const page = (url: string, text: string, links: Array<[string, string]> = []): PageRead =>
  ({ url, text, links: links.map(([text, href]) => ({ text, href })) });

const noNews = vi.fn(async () => null) as unknown as typeof fetchNews;

const input = (over: Partial<CollectInput> = {}): CollectInput => ({
  vacancyUrl: 'https://www.itsax.de/stellen/123', partnerUrl: '', company: 'Symate GmbH', websiteHint: '', skipVacancyPage: false, ...over,
});

const ITSAX: Site = {
  'https://www.itsax.de/stellen/123': page('https://www.itsax.de/stellen/123',
    'Webentwickler (m/w/d) bei Symate GmbH in Dresden. Ihr Ansprechpartner: Herr Max Juhrisch, Tel. 0351 1234567',
    [['Zur Website des Unternehmens', 'https://www.symate.de/'], ['Impressum', 'https://www.itsax.de/impressum']]),
  'https://www.symate.de': page('https://www.symate.de/', 'Symate GmbH – Software für die Kunststoffindustrie.',
    [['Impressum', 'https://www.symate.de/impressum'], ['Datenschutz', 'https://www.symate.de/datenschutz']]),
  'https://www.symate.de/impressum': page('https://www.symate.de/impressum',
    'Impressum\nSymate GmbH\nAm Lagerplatz 8\n01099 Dresden\nE-Mail: info@symate.de', [['E-Mail', 'mailto:info@symate.de']]),
};

describe('research collect', () => {
  it('ITsax → company site → Impressum: contact filled, 3 pages read', async () => {
    const f = fakeReader(ITSAX);
    const out = await collect(input(), 'full', { reader: f.reader, fetchNews: noNews, now: f.clock }, new AbortController().signal);
    expect(out.website).toBe('https://www.symate.de');
    expect(out.pages.map((p) => p.kind)).toEqual(['vacancy', 'home', 'impressum']);
    expect(out.contact.email).toBe('info@symate.de');
    expect(out.contact.postcode).toBe('01099');
    expect(out.sources.map((s) => s.kind)).toEqual(['vacancy', 'home', 'impressum']);
    expect(f.opened).toHaveLength(3);
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.deadlines[0]).toBe(NOW.getTime() + COLLECT_BUDGET_MS);
  });

  it('never more than 6 pages, stops at 60 s budget', async () => {
    const links: Array<[string, string]> = [
      ['Impressum', 'https://www.symate.de/impressum'], ['Kontakt', 'https://www.symate.de/kontakt'],
      ['Jetzt bewerben', 'https://www.symate.de/bewerben'], ['Karriere', 'https://www.symate.de/karriere'],
      ['Über uns', 'https://www.symate.de/ueber-uns'], ['Jobs', 'https://www.symate.de/jobs'],
    ];
    const site: Site = { 'https://www.symate.de': page('https://www.symate.de', 'Symate GmbH', links) };
    for (const [, href] of links) site[key(href)] = page(href, 'Symate GmbH', links);
    const many = fakeReader(site);
    const out = await collect(input({ vacancyUrl: 'https://www.symate.de/stellen/1' }), 'contact',
      { reader: many.reader, fetchNews: noNews, now: many.clock }, new AbortController().signal);
    expect(many.opened.length).toBeLessThanOrEqual(MAX_PAGES);
    expect(many.opened).toHaveLength(MAX_PAGES);
    expect(out.pages.length).toBeLessThanOrEqual(MAX_PAGES);

    const slow = fakeReader(site, { stepMs: 25_000 });
    await collect(input({ vacancyUrl: 'https://www.symate.de/stellen/1' }), 'contact',
      { reader: slow.reader, fetchNews: noNews, now: slow.clock }, new AbortController().signal);
    expect(slow.opened).toHaveLength(3); // 0 s, 25 s, 50 s — at 75 s the budget is spent
    expect(slow.close).toHaveBeenCalledTimes(1);
  });

  it('guessed domain without the company name on the page is rejected → website empty', async () => {
    const site: Site = {
      'https://www.itsax.de/stellen/123': page('https://www.itsax.de/stellen/123', 'Webentwickler bei Symate GmbH'),
      'https://www.symate.de': page('https://www.symate.de', 'Diese Domain symate.de steht zum Verkauf!'),
      'https://www.symate.com': page('https://www.symate.com', 'Welcome to our shop'),
    };
    const f = fakeReader(site);
    const out = await collect(input(), 'contact', { reader: f.reader, fetchNews: noNews, now: f.clock }, new AbortController().signal);
    expect(out.website).toBe('');
    expect(out.pages.map((p) => p.kind)).toEqual(['vacancy']);
    expect(out.sources.map((s) => s.url)).toEqual(['https://www.itsax.de/stellen/123']);
  });

  it('contact mode does not fetch news', async () => {
    const news = vi.fn(async () => [] as ResearchNews[]);
    const f = fakeReader(ITSAX);
    const out = await collect(input(), 'contact', { reader: f.reader, fetchNews: news as unknown as typeof fetchNews, now: f.clock }, new AbortController().signal);
    expect(news).not.toHaveBeenCalled();
    expect(out.news).toBeNull();
  });

  it('full mode returns the news and lists them as sources', async () => {
    const item: ResearchNews = { title: 'Symate gewinnt Preis', date: '2026-10-30', source: 'MDR', url: 'https://news.google.com/rss/articles/B' };
    const news = vi.fn(async () => [item]);
    const f = fakeReader(ITSAX);
    const out = await collect(input(), 'full', { reader: f.reader, fetchNews: news as unknown as typeof fetchNews, now: f.clock }, new AbortController().signal);
    expect(news).toHaveBeenCalledWith('Symate GmbH', expect.anything());
    expect(out.news).toEqual([item]);
    expect(out.sources.at(-1)).toEqual({ url: item.url, kind: 'news' });
  });

  it('an unreadable vacancy page still searches the website by name', async () => {
    const f = fakeReader({ ...ITSAX, 'https://www.itsax.de/stellen/123': 'fail',
      'https://www.symate.de': page('https://www.symate.de', 'Impressum: Symate GmbH, Geschäftsführer …', [['Impressum', 'https://www.symate.de/impressum']]) });
    const out = await collect(input(), 'contact', { reader: f.reader, fetchNews: noNews, now: f.clock }, new AbortController().signal);
    expect(f.opened[0]).toBe('https://www.itsax.de/stellen/123');
    expect(out.website).toBe('https://www.symate.de');
    expect(out.pages.map((p) => p.kind)).toEqual(['home', 'impressum']);
    expect(out.contact.email).toBe('info@symate.de');
  });

  it('the person\'s website is used without a name check', async () => {
    const f = fakeReader({ 'https://firma.example': page('https://firma.example', 'Willkommen', [['Kontakt', 'https://firma.example/kontakt']]),
      'https://firma.example/kontakt': page('https://firma.example/kontakt', 'Kontakt: jobs@firma.example') });
    const out = await collect(input({ vacancyUrl: '', websiteHint: 'https://firma.example' }), 'contact',
      { reader: f.reader, fetchNews: noNews, now: f.clock }, new AbortController().signal);
    expect(out.website).toBe('https://firma.example');
    expect(out.pages.map((p) => p.kind)).toEqual(['home', 'contact']);
  });

  it('AA with a partner link reads the partner page first, never the AA page (R6)', async () => {
    const f = fakeReader({ ...ITSAX, 'https://www.symate.de/karriere/webentwickler': page('https://www.symate.de/karriere/webentwickler',
      'Webentwickler bei Symate GmbH. Bewerbung an jobs@symate.de', [['Impressum', 'https://www.symate.de/impressum']]) });
    const out = await collect(input({ vacancyUrl: 'https://www.arbeitsagentur.de/jobsuche/jobdetail/1', partnerUrl: 'https://www.symate.de/karriere/webentwickler', skipVacancyPage: true }),
      'contact', { reader: f.reader, fetchNews: noNews, now: f.clock }, new AbortController().signal);
    expect(f.opened.some((u) => u.includes('arbeitsagentur'))).toBe(false);
    expect(f.opened[0]).toBe('https://www.symate.de/karriere/webentwickler');
    expect(out.website).toBe('https://www.symate.de');
    expect(out.contact.email).toBe('jobs@symate.de');
  });

  it('links with a login are dropped', async () => {
    const f = fakeReader({ 'https://www.symate.de/stellen/1': page('https://www.symate.de/stellen/1', 'Symate GmbH',
      [['Impressum', 'https://user:pw@www.symate.de/impressum']]) });
    const out = await collect(input({ vacancyUrl: 'https://www.symate.de/stellen/1' }), 'contact',
      { reader: f.reader, fetchNews: noNews, now: f.clock }, new AbortController().signal);
    expect(f.opened.some((u) => u.includes('user:pw'))).toBe(false);
    expect(out.pages[0].links).toEqual([]);
  });

  it('abort closes the session', async () => {
    const ctrl = new AbortController();
    const f = fakeReader(ITSAX, { onOpen: (url) => { if (url.includes('symate')) ctrl.abort(); } });
    const news = vi.fn(async () => null);
    await expect(collect(input(), 'full', { reader: f.reader, fetchNews: news as unknown as typeof fetchNews, now: f.clock }, ctrl.signal))
      .rejects.toMatchObject({ code: 'LLM_CANCELLED' });
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.opened).toHaveLength(2);
  });

  it('a missing browser is passed on', async () => {
    const reader: PageReader = { read: async () => '', session: async () => { throw new AppError('BROWSER_MISSING', 'none'); } };
    await expect(collect(input(), 'full', { reader, fetchNews: noNews, now: () => NOW }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'BROWSER_MISSING' });
  });
});

describe('research collect — fix round 1', () => {
  it('a malformed mailto does not break the research; a list of addresses gives the first', async () => {
    const f = fakeReader({
      'https://www.itsax.de/stellen/123': page('https://www.itsax.de/stellen/123', 'Webentwickler bei Symate GmbH',
        [['Mail', 'mailto:%E0@x.de'], ['Bewerbung', 'mailto:jobs@symate.de,b@y.de']]),
      'https://symate.de': page('https://symate.de', 'Symate GmbH'),
    });
    const out = await collect(input(), 'contact', { reader: f.reader, fetchNews: noNews, now: f.clock }, new AbortController().signal);
    expect(out.website).toBe('https://symate.de');
    expect(f.opened.some((u) => u.includes('y.de') && !u.includes('symate'))).toBe(false);
  });

  it('an unreadable Impressum does not block a second Impressum link', async () => {
    const f = fakeReader({
      'https://www.symate.de/stellen/1': page('https://www.symate.de/stellen/1', 'Symate GmbH',
        [['Impressum', 'https://www.symate.de/impressum'], ['Impressum', 'https://www.symate.de/de/impressum']]),
      'https://www.symate.de/impressum': 'fail',
      'https://www.symate.de/de/impressum': page('https://www.symate.de/de/impressum', 'Impressum Symate GmbH E-Mail: info@symate.de'),
    });
    const out = await collect(input({ vacancyUrl: 'https://www.symate.de/stellen/1' }), 'contact',
      { reader: f.reader, fetchNews: noNews, now: f.clock }, new AbortController().signal);
    expect(f.opened).toEqual(['https://www.symate.de/stellen/1', 'https://www.symate.de/impressum', 'https://www.symate.de/de/impressum']);
    expect(out.pages.map((p) => p.kind)).toEqual(['vacancy', 'impressum']);
  });

  it('a missing browser means no news request at all', async () => {
    const news = vi.fn(async () => null);
    const reader: PageReader = { read: async () => '', session: async () => { throw new AppError('BROWSER_MISSING', 'none'); } };
    await expect(collect(input(), 'full', { reader, fetchNews: news as unknown as typeof fetchNews, now: () => NOW }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'BROWSER_MISSING' });
    expect(news).not.toHaveBeenCalled();
  });

  it('news gets its own signal, aborted when the research ends with an error', async () => {
    let newsSignal: AbortSignal | null = null;
    const news = vi.fn((_c: string, s: AbortSignal) => { newsSignal = s; return new Promise<null>(() => undefined); });
    const ctrl = new AbortController();
    const f = fakeReader(ITSAX, { onOpen: () => ctrl.abort() });
    await expect(collect(input(), 'full', { reader: f.reader, fetchNews: news as unknown as typeof fetchNews, now: f.clock }, ctrl.signal))
      .rejects.toMatchObject({ code: 'LLM_CANCELLED' });
    expect(newsSignal).not.toBeNull();
    expect(newsSignal!.aborted).toBe(true);
  });

  it('the address a page redirected to is not opened again', async () => {
    const f = fakeReader({
      'https://www.symate.de/stellen/1': page('https://www.symate.de/stellen/1', 'Symate GmbH',
        [['Kontakt', 'https://www.symate.de/kontakt'], ['Impressum', 'https://www.symate.de/impressum-alt']]),
      'https://www.symate.de/impressum-alt': page('https://www.symate.de/kontakt', 'Kontakt Symate GmbH',
        [['Kontakt', 'https://www.symate.de/kontakt']]),
      'https://www.symate.de/kontakt': page('https://www.symate.de/kontakt', 'Kontakt Symate GmbH'),
    });
    await collect(input({ vacancyUrl: 'https://www.symate.de/stellen/1' }), 'contact',
      { reader: f.reader, fetchNews: noNews, now: f.clock }, new AbortController().signal);
    expect(f.opened).toEqual(['https://www.symate.de/stellen/1', 'https://www.symate.de/impressum-alt']);
  });
});
