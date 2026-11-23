import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/errors.js';
import { collect, type CollectInput } from '../src/research/collect.js';
import { contactFromPages, type FoundPage } from '../src/research/contact-merge.js';
import { companySlugs, guessSlugs, websiteCandidates } from '../src/research/links.js';
import type { PageRead, PageReader } from '../src/vacancies/sources/page-reader.js';

/**
 * Gaps found by the live check of 0.13.0 (Task 12b): long names lose the short domain (C2), one-word names were
 * rejected on the real site (C3), a foreign domain beat the company's own address (C4).
 */

const NOW = new Date('2026-11-23T10:00:00Z');
const key = (url: string) => url.replace(/\/$/, '');
const page = (url: string, text: string, links: Array<[string, string]> = []): PageRead =>
  ({ url, text, links: links.map(([text, href]) => ({ text, href })) });

function fakeReader(site: Record<string, PageRead>) {
  let now = NOW.getTime();
  const opened: string[] = [];
  const reader: PageReader = {
    read: async () => { throw new Error('not used'); },
    session: async () => ({
      open: async (url: string) => {
        opened.push(url);
        now += 1000;
        const p = site[key(url)];
        if (!p) throw new AppError('BAD_REQUEST', 'page not readable: failed', 'pageUnreadable');
        return p;
      },
      close: vi.fn(async () => undefined),
    }),
  };
  return { reader, opened, clock: () => new Date(now) };
}

const run = (site: Record<string, PageRead>, over: Partial<CollectInput>) => {
  const f = fakeReader(site);
  const input: CollectInput = { vacancyUrl: '', partnerUrl: '', company: '', websiteHint: '', skipVacancyPage: false, ...over };
  return collect(input, 'contact', { reader: f.reader, fetchNews: null, now: f.clock }, new AbortController().signal)
    .then((out) => ({ out, opened: f.opened }));
};

describe('C2: long names also guess the short domain', () => {
  it('Helm & Walter IT-Solutions GmbH guesses helmundwalter.de', () => {
    const urls = websiteCandidates({ pageUrl: '', links: [], emails: [], company: 'Helm & Walter IT-Solutions GmbH' }).map((c) => c.url);
    expect(urls).toContain('https://www.helmundwalter.de');
    // every .de guess comes before any .com guess
    const lastDe = urls.map((u) => u.endsWith('.de')).lastIndexOf(true);
    const firstCom = urls.findIndex((u) => u.endsWith('.com'));
    expect(firstCom === -1 || lastDe < firstCom).toBe(true);
    expect(urls.indexOf('https://www.helmundwalter.de')).toBeLessThanOrEqual(1);
  });

  it('a name that is only descriptors after cutting gives no shortened slug', () => {
    expect(guessSlugs('IT Solutions GmbH')).toEqual(companySlugs('IT Solutions GmbH'));
    expect(guessSlugs('Software Services GmbH')).toEqual(companySlugs('Software Services GmbH'));
  });

  it('the trusted slugs (no name check) stay the full name only', () => {
    expect(companySlugs('Helm & Walter IT-Solutions GmbH')).not.toContain('helmundwalter');
  });

  it('a short form that is generic or too short is not guessed', () => {
    expect(guessSlugs('AB Systems GmbH')).toEqual(companySlugs('AB Systems GmbH'));
    expect(guessSlugs('Personalvermittlung Services GmbH')).toEqual(companySlugs('Personalvermittlung Services GmbH'));
  });

  it('an HTML entity in the name is read as its character', () => {
    expect(companySlugs('Helm &amp; Walter GmbH')).toEqual(companySlugs('Helm & Walter GmbH'));
  });
});

describe('C3: a one-word name is confirmed by the site’s own Impressum', () => {
  const BOARD = 'https://www.stepstone.de/job/12817717';
  const boardPage = page(BOARD, 'SAP-Berater (m/w/d) bei iSAX GmbH & Co. KG', [['Alle Jobs', 'https://www.stepstone.de/jobs']]);

  it('home says only "iSAX", the Impressum names "iSAX GmbH" → site taken, Impressum read once', async () => {
    const { out, opened } = await run({
      [BOARD]: boardPage,
      'https://www.isax.de': page('https://www.isax.de/', 'iSAX – Ihr Partner für SAP in Sachsen.', [['Impressum', 'https://www.isax.de/impressum']]),
      'https://www.isax.de/impressum': page('https://www.isax.de/impressum',
        'Impressum\niSAX GmbH & Co. KG\nGeschäftsführer: Max Muster\nE-Mail: info@isax.de', [['E-Mail', 'mailto:info@isax.de']]),
    }, { vacancyUrl: BOARD, company: 'iSAX GmbH & Co. KG' });
    expect(out.website).toBe('https://www.isax.de');
    expect(out.pages.map((p) => p.kind)).toEqual(['vacancy', 'home', 'impressum']);
    expect(opened.filter((u) => u.includes('/impressum'))).toHaveLength(1);
    expect(out.contact.email).toBe('info@isax.de');
  });

  it('the Impressum does not name the company → site rejected, neither page kept', async () => {
    const { out } = await run({
      [BOARD]: boardPage,
      'https://www.isax.de': page('https://www.isax.de/', 'iSAX – Ihr Partner für SAP in Sachsen.', [['Impressum', 'https://www.isax.de/impressum']]),
      'https://www.isax.de/impressum': page('https://www.isax.de/impressum', 'Impressum\nAndere Firma GmbH\nGeschäftsführer: X'),
    }, { vacancyUrl: BOARD, company: 'iSAX GmbH & Co. KG' });
    expect(out.website).toBe('');
    expect(out.pages.map((p) => p.kind)).toEqual(['vacancy']);
  });

  it('a parked domain page is still no evidence: its Impressum is not even opened', async () => {
    const { out, opened } = await run({
      [BOARD]: boardPage,
      'https://www.isax.de': page('https://www.isax.de/', 'Die Domain isax.de steht zum Verkauf.', [['Impressum', 'https://www.isax.de/impressum']]),
      'https://www.isax.de/impressum': page('https://www.isax.de/impressum', 'Impressum\nDomainhandel GmbH\nGeschäftsführer: X\nisax'),
    }, { vacancyUrl: BOARD, company: 'iSAX GmbH & Co. KG' });
    expect(out.website).toBe('');
    expect(opened).not.toContain('https://www.isax.de/impressum');
  });
});

describe('C4: the company’s own domain wins across pages', () => {
  const site = 'https://egocentric-systems.de';
  const vacancy = (text: string, mails: string[] = []): FoundPage =>
    ({ url: 'https://egocentric-systems-gmbh.jobs.personio.de/job/861470', kind: 'vacancy', text, links: mails.map((m) => ({ text: m, href: `mailto:${m}` })) });

  it('a foreign address on the vacancy page loses to an own-domain address on the contact page', () => {
    const c = contactFromPages([
      vacancy('Fragen? info@get-vibe.de'),
      { url: 'https://www.egocentric-systems.de/kontakt', kind: 'contact', text: 'Kontakt: service@egocentric-systems.de', links: [] },
    ], site);
    expect(c.email).toBe('service@egocentric-systems.de');
  });

  it('no own-domain address anywhere → the vacancy page address as before', () => {
    const c = contactFromPages([
      vacancy('Fragen? info@get-vibe.de'),
      { url: 'https://www.egocentric-systems.de/kontakt', kind: 'contact', text: 'Nutzen Sie unser Kontaktformular.', links: [] },
    ], site);
    expect(c.email).toBe('info@get-vibe.de');
  });

  it('own-domain jobs@ on the vacancy page still beats own-domain info@ in the Impressum', () => {
    const c = contactFromPages([
      { url: 'https://www.egocentric-systems.de/impressum', kind: 'impressum', text: 'E-Mail: info@egocentric-systems.de', links: [] },
      vacancy('Bewerbung an jobs@egocentric-systems.de oder info@get-vibe.de'),
    ], site);
    expect(c.email).toBe('jobs@egocentric-systems.de');
  });
});
