import { describe, expect, it, vi } from 'vitest';
import type { VacancyContact } from '@bp/shared';
import { AppError } from '../src/errors.js';
import { collect, type CollectInput } from '../src/research/collect.js';
import { mergeContact } from '../src/research/contact-merge.js';
import { isApplyService, isBoard, nameOnPage, websiteCandidates } from '../src/research/links.js';
import type { PageRead, PageReader } from '../src/vacancies/sources/page-reader.js';

/**
 * Final review of 0.13.0: a pasted page on a board or applicant system that is not in the lists must not become the
 * company site (I1); host names match a slug only at label/hyphen boundaries (T3a); "Data-Center" is no one-word name
 * evidence (T3b); an address is filled only as a whole (M1). Every company and address below is made up.
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

describe('I1: an unlisted board or applicant system is not the company site', () => {
  const AD = 'https://www.jobportal-sachsen.example/stelle/4711';
  const adPage = page(AD, [
    'Webentwickler (m/w/d) bei der Muster Shop GmbH in Dresden.',
    'Ihr Ansprechpartner: Frau Erika Beispiel, Tel. 0351 1234567',
    'Bewerbung an bewerbung@muster-shop.example',
    'Jobportal Sachsen GmbH · Hauptstraße 1 · 01067 Dresden · info@jobportal-sachsen.example · Tel. 0351 9999999',
  ].join('\n'), [
    ['Impressum', 'https://www.jobportal-sachsen.example/impressum'],
    ['Kontakt', 'https://www.jobportal-sachsen.example/kontakt'],
    ['Zur Website des Arbeitgebers', 'https://www.muster-shop.example/'],
    ['info@jobportal-sachsen.example', 'mailto:info@jobportal-sachsen.example'],
    ['Anrufen', 'tel:+493519999999'],
  ]);
  const boardImpressum = page('https://www.jobportal-sachsen.example/impressum',
    'Impressum\nJobportal Sachsen GmbH\nHauptstraße 1\n01067 Dresden\nGeschäftsführer: Max Portal\nE-Mail: info@jobportal-sachsen.example');

  it('(a)+(b) the pasted page is checked by its own Impressum, rejected, and the employer site from its links is used', async () => {
    const { out } = await run({
      [AD]: adPage,
      'https://www.jobportal-sachsen.example/impressum': boardImpressum,
      'https://www.muster-shop.example': page('https://www.muster-shop.example/', 'Muster Shop GmbH – Online-Shops aus Dresden',
        [['Impressum', 'https://www.muster-shop.example/impressum']]),
      'https://www.muster-shop.example/impressum': page('https://www.muster-shop.example/impressum',
        'Impressum\nMuster Shop GmbH\nShopstraße 5\n01069 Dresden\nE-Mail: info@muster-shop.example'),
    }, { vacancyUrl: AD, company: 'Muster Shop GmbH' });
    expect(out.website).toBe('https://www.muster-shop.example');
    expect(out.contact.email).toBe('bewerbung@muster-shop.example');
    expect(out.contact.street).toBe('Shopstraße 5');
    expect(JSON.stringify(out.contact)).not.toContain('jobportal');
    expect(out.contact.phone).not.toContain('9999999');
    // The board's own Impressum is neither a source nor a contact page.
    expect(out.pages.some((p) => p.url.includes('jobportal-sachsen.example/impressum'))).toBe(false);
  });

  it('(a) no employer site found: still no board e-mail, phone or address — only the ad', async () => {
    const { out } = await run({
      [AD]: { ...adPage, links: adPage.links.filter((l) => !l.href.includes('muster-shop')) },
      'https://www.jobportal-sachsen.example/impressum': boardImpressum,
    }, { vacancyUrl: AD, company: 'Muster Shop GmbH' });
    // The employer's own domain from the ad's e-mail may become the site (its host holds the name) — never the board.
    expect(out.website).not.toContain('jobportal');
    expect(out.contact.email).toBe('bewerbung@muster-shop.example');
    expect(out.contact.street).toBe('');
    expect(out.contact.postcode).toBe('');
    expect(out.contact.phone).not.toContain('9999999');
  });

  it('(c) the company’s own careers page (host holds the name) is still trusted without a check', () => {
    expect(websiteCandidates({ pageUrl: 'https://karriere.muster-shop.de/stelle/1', links: [], emails: [], company: 'Muster Shop GmbH' })[0])
      .toEqual({ url: 'https://karriere.muster-shop.de', nameCheck: false });
  });

  it('(c) an unlisted page without the name in its host needs a check, its outbound links become candidates', () => {
    const c = websiteCandidates({
      pageUrl: AD, links: adPage.links.map((l) => ({ text: l.text, href: l.href })), emails: [], company: 'Muster Shop GmbH',
    });
    expect(c).toContainEqual({ url: 'https://www.jobportal-sachsen.example', nameCheck: true });
    // A linked site whose host holds the name comes first and is trusted, as from a known board (R7).
    expect(c[0]).toEqual({ url: 'https://www.muster-shop.example', nameCheck: false });
  });

  it('a company page confirmed by its own Impressum stays the site (host without the name)', async () => {
    const CAREER = 'https://www.mshop-online.example/karriere/webentwickler';
    const { out } = await run({
      [CAREER]: page(CAREER, 'Webentwickler (m/w/d). Bewerbung an jobs@mshop-online.example',
        [['Impressum', 'https://www.mshop-online.example/impressum']]),
      'https://www.mshop-online.example/impressum': page('https://www.mshop-online.example/impressum',
        'Impressum\nMuster Shop GmbH\nShopstraße 5\n01069 Dresden'),
    }, { vacancyUrl: CAREER, company: 'Muster Shop GmbH' });
    expect(out.website).toBe('https://www.mshop-online.example');
    expect(out.contact.email).toBe('jobs@mshop-online.example');
    expect(out.contact.street).toBe('Shopstraße 5');
  });

  it('common German boards and applicant systems are known', () => {
    for (const h of ['www.stellenanzeigen.de', 'www.jobware.de', 'jobs.meinestadt.de', 'www.yourfirm.de', 'jobs.heise.de',
      'www.absolventa.de', 'www.gulp.de', 'www.freelancermap.de', 'www.karriere.at', 'www.heyjobs.co']) expect(isBoard(h), h).toBe(true);
    for (const h of ['muster.rexx-systems.com', 'karriere.concludis.de', 'apply.workable.com', 'muster.teamtailor.com',
      'jobs.ashbyhq.com', 'career5.successfactors.eu', 'muster.taleo.net', 'muster.jobbase.io']) expect(isApplyService(h), h).toBe(true);
  });
});

describe('T3a: a slug matches a host only at label or hyphen boundaries', () => {
  it('bigdata-agentur.de is not trusted for "Data GmbH"; data-solutions.de and data.de are', () => {
    const c = websiteCandidates({
      pageUrl: 'https://www.stepstone.de/job/1',
      links: [{ text: '', href: 'https://www.bigdata-agentur.de/' }, { text: '', href: 'https://www.data-solutions.de/' }],
      emails: [], company: 'Data GmbH',
    });
    expect(c).toContainEqual({ url: 'https://www.bigdata-agentur.de', nameCheck: true });
    expect(c[0]).toEqual({ url: 'https://www.data-solutions.de', nameCheck: false });
  });

  it('a slug shorter than 4 letters is never trusted without a check', () => {
    const c = websiteCandidates({ pageUrl: 'https://www.stepstone.de/job/1', links: [{ text: '', href: 'https://www.abc.de/' }], emails: [], company: 'ABC GmbH' });
    expect(c).toContainEqual({ url: 'https://www.abc.de', nameCheck: true });
  });
});

describe('T3b: a hyphenated word is no one-word name evidence', () => {
  it('"Data-Center" next to "Geschäftsführer" does not confirm "Data GmbH"', () => {
    expect(nameOnPage('Data GmbH', 'Geschäftsführer: Max Muster. Unser Data-Center steht in Dresden.')).toBe(false);
    expect(nameOnPage('Data GmbH', 'Impressum Data GmbH, Geschäftsführer Max Muster')).toBe(true);
  });
});

describe('M1: the address is filled only as a whole', () => {
  const empty: VacancyContact = { email: '', salutation: '', name: '', phone: '', street: '', postcode: '', city: '' };
  const found: VacancyContact = { ...empty, street: 'Shopstraße 5', postcode: '01069', city: 'Dresden' };

  it('card with only a city: the found address is offered, never mixed in', () => {
    const r = mergeContact({ ...empty, city: 'Leipzig' }, found, undefined);
    expect(r.contact).toMatchObject({ street: '', postcode: '', city: 'Leipzig' });
    expect(r.differing).toMatchObject({ street: 'Shopstraße 5', postcode: '01069', city: 'Dresden' });
    expect(r.auto).toEqual([]);
  });

  it('card without any address: all three fields are filled and marked', () => {
    const r = mergeContact({ ...empty, email: 'a@b.de' }, found, undefined);
    expect(r.contact).toMatchObject({ street: 'Shopstraße 5', postcode: '01069', city: 'Dresden' });
    expect(r.auto).toEqual(['street', 'postcode', 'city']);
  });

  it('the same address written differently is not offered', () => {
    const r = mergeContact({ ...empty, street: 'shopstraße  5', postcode: '01069', city: 'dresden' }, found, undefined);
    expect(r.differing).toEqual({});
  });
});

describe('I2: the research uses the background lane, Find contact the interactive one', () => {
  it('collect asks for a session in the lane of its mode', async () => {
    const lanes: Array<string | undefined> = [];
    const reader: PageReader = {
      read: async () => { throw new Error('not used'); },
      session: async (_signal, _deadline, lane) => {
        lanes.push(lane);
        return { open: async () => { throw new AppError('BAD_REQUEST', 'page not readable: failed', 'pageUnreadable'); }, close: async () => undefined };
      },
    };
    const input: CollectInput = { vacancyUrl: 'https://www.muster.example/job', partnerUrl: '', company: '', websiteHint: '', skipVacancyPage: false };
    await collect(input, 'contact', { reader, fetchNews: null, now: () => NOW }, new AbortController().signal);
    await collect(input, 'full', { reader, fetchNews: null, now: () => NOW }, new AbortController().signal);
    expect(lanes).toEqual(['interactive', 'background']);
  });
});

describe('0.13.2: the parked final review findings', () => {
  const shop = page('https://www.muster-shop.example/', 'Muster Shop GmbH');

  it('an unlisted page without an Impressum link is confirmed by the Impressum linked from its home page', async () => {
    const { out } = await run({
      'https://www.mshop.example/jobs/1': page('https://www.mshop.example/jobs/1', 'Webentwickler bei Muster Shop GmbH'),
      'https://www.mshop.example': page('https://www.mshop.example/', 'Willkommen', [['Impressum', 'https://www.mshop.example/impressum']]),
      'https://www.mshop.example/impressum': page('https://www.mshop.example/impressum', 'Impressum\nMuster Shop GmbH\nShopstraße 5\n01069 Dresden'),
    }, { vacancyUrl: 'https://www.mshop.example/jobs/1', company: 'Muster Shop GmbH' });
    expect(out.website).toBe('https://www.mshop.example');
    expect(out.contact.street).toBe('Shopstraße 5');
  });

  it('a board whose home page only names the company as a customer is still not its site', async () => {
    const { out } = await run({
      'https://www.jobs-ost.example/1': page('https://www.jobs-ost.example/1', 'Webentwickler bei Muster Shop GmbH'),
      'https://www.jobs-ost.example': page('https://www.jobs-ost.example/', 'Top-Arbeitgeber: Muster Shop GmbH'),
    }, { vacancyUrl: 'https://www.jobs-ost.example/1', company: 'Muster Shop GmbH' });
    expect(out.website).toBe('');
    expect(out.pages.map((p) => p.url)).toEqual(['https://www.jobs-ost.example/1']);
  });

  it('a three-letter host that is exactly the name is confirmed by its home page', async () => {
    const { out } = await run({
      'https://www.abc.example/jobs/1': page('https://www.abc.example/jobs/1', 'Webentwickler gesucht'),
      'https://www.abc.example': page('https://www.abc.example/', 'ABC GmbH – Software'),
    }, { vacancyUrl: 'https://www.abc.example/jobs/1', company: 'ABC GmbH' });
    expect(out.website).toBe('https://www.abc.example');
  });

  it('a guess that redirects to a social network or board is never the company site', async () => {
    const { out } = await run({
      'https://www.muster-shop.de': { ...shop, url: 'https://www.linkedin.com/company/muster-shop' },
    }, { company: 'Muster Shop GmbH' });
    expect(out.website).toBe('');
    expect(out.pages).toEqual([]);
  });

  it('the contact block of the  beats a recruiting-like box in the footer of a board', async () => {
    const text = [
      'Webentwickler bei Muster Shop GmbH', 'Kontaktadresse', 'Muster Shop GmbH', 'Frau Erika Beispiel',
      'E-Mail: erika@muster-it.example', '', 'Webdesign: jobs@agentur.example',
    ].join('\n');
    const { out } = await run({ 'https://www.itsax.de/stellen/9': page('https://www.itsax.de/stellen/9', text) },
      { vacancyUrl: 'https://www.itsax.de/stellen/9', company: 'Muster Shop GmbH' });
    expect(out.contact.email).toBe('erika@muster-it.example');
  });
});
