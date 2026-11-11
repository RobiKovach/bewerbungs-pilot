import { describe, expect, it } from 'vitest';
import {
  companySlugs, isApplyService, isBoard, isIgnored, nameOnPage, nextPages, pageKind, siteOf, websiteCandidates,
} from '../src/research/links.js';

const link = (text: string, href: string) => ({ text, href });

describe('research links: page kinds', () => {
  it('reads the kind from the link text or address (de/en)', () => {
    expect(pageKind(link('Impressum', 'https://www.symate.de/impressum'))).toBe('impressum');
    expect(pageKind(link('Legal notice', 'https://x.de/legal'))).toBe('impressum');
    expect(pageKind(link('', 'https://x.de/imprint'))).toBe('impressum');
    expect(pageKind(link('Kontakt aufnehmen', 'https://helmundwalter.de/impressum#contact-form'))).toBe('impressum');
    expect(pageKind(link('Kontakt', 'https://www.isax.com/service/kontakt/'))).toBe('contact');
    expect(pageKind(link('Jetzt bewerben', 'https://x.de/karriere/123'))).toBe('apply');
    expect(pageKind(link('Apply now', 'https://x.de/j/1'))).toBe('apply');
    expect(pageKind(link('', 'https://www.symate.de/jobs'))).toBe('careers');
    expect(pageKind(link('Stellenangebote', 'https://x.de/s'))).toBe('careers');
    expect(pageKind(link('Über uns', 'https://x.de/u'))).toBe('about');
    expect(pageKind(link('', 'https://x.de/ueber-uns'))).toBe('about');
    expect(pageKind(link('Startseite', 'https://x.de/'))).toBeNull();
  });

  it('does not take settings words for careers', () => {
    expect(pageKind(link('Cookie-Einstellungen', 'https://x.de/#cookies'))).toBeNull();
    expect(pageKind(link('Jetzt bestellen', 'https://x.de/shop'))).toBeNull();
  });

  it('reads text and path only: never the host or the #fragment (I1)', () => {
    expect(pageKind(link('finden Sie hier', 'https://bms.empfehlungsbund.de/datenschutz#bewerbungsformular'))).toBeNull();
    expect(pageKind(link('Team', 'https://jobs.firma.de/team'))).toBeNull();
    expect(pageKind(link('', 'https://jobs.firma.de/'))).toBeNull();
    expect(pageKind(link('Impressum', 'https://jobs.firma.de/impressum'))).toBe('impressum');
    expect(pageKind(link('Mehr', 'https://x.de/seite#kontakt'))).toBeNull();
  });

  it('privacy, cookie and terms pages are never a page kind, even about applications (I1)', () => {
    expect(pageKind(link('Datenschutzhinweise für Bewerber', 'https://x.de/hinweise'))).toBeNull();
    expect(pageKind(link('Hinweise', 'https://x.de/datenschutz-bewerbung'))).toBeNull();
    expect(pageKind(link('Privacy policy', 'https://x.de/privacy'))).toBeNull();
    expect(pageKind(link('AGB', 'https://x.de/agb'))).toBeNull();
    expect(pageKind(link('Nutzungsbedingungen', 'https://x.de/n'))).toBeNull();
  });
});

describe('research links: hosts', () => {
  it('knows boards, apply services and ignored hosts by suffix', () => {
    expect(isBoard('www.stepstone.de')).toBe(true);
    expect(isBoard('en.itsax.de')).toBe(true);
    expect(isBoard('www.arbeitsagentur.de')).toBe(true);
    expect(isBoard('helmundwalter.de')).toBe(false);
    expect(isApplyService('acme.jobs.personio.de')).toBe(true);
    expect(isApplyService('bms.empfehlungsbund.de')).toBe(true);
    expect(isApplyService('jobs.hw.ag')).toBe(false);
    expect(isIgnored('www.facebook.com')).toBe(true);
    expect(isIgnored('maps.google.de')).toBe(true);
    expect(isIgnored('www.google.co.uk')).toBe(true);
    expect(isIgnored('de.glassdoor.ch')).toBe(true);
    expect(isIgnored('fonts.googleapis.com')).toBe(true);
    expect(isIgnored('googlefirm.de')).toBe(false);
    expect(isIgnored('www.symate.de')).toBe(false);
  });

  it('boards and review/social sites match on any TLD; board group sites are ignored (R7)', () => {
    for (const h of ['www.stepstone.at', 'de.indeed.com', 'at.indeed.com', 'www.xing.de', 'de.linkedin.com']) expect(isBoard(h)).toBe(true);
    for (const h of ['www.kununu.de', 'www.kununu.com', 'de.trustpilot.com', 'www.glassdoor.de', 'www.thestepstonegroup.com']) expect(isIgnored(h)).toBe(true);
    expect(isBoard('stepstonefirma.de')).toBe(false);
  });

  it('siteOf compares without www.', () => {
    expect(siteOf('https://www.symate.de/jobs')).toBe('https://symate.de');
    expect(siteOf('http://symate.de')).toBe('https://symate.de');
    expect(siteOf('not a url')).toBe('');
  });
});

describe('research links: company slugs and name on page', () => {
  it('drops the legal form, umlauts and punctuation; hyphen and joined forms', () => {
    expect(companySlugs('iSAX GmbH & Co. KG')).toEqual(['isax']);
    expect(companySlugs('Helm & Walter GmbH')).toEqual(['helm-walter', 'helmwalter', 'helmundwalter']);
    expect(companySlugs('Müller Bäckerei AG')).toEqual(['mueller-baeckerei', 'muellerbaeckerei']);
    expect(companySlugs('Beispiel UG (haftungsbeschränkt)')).toEqual(['beispiel']);
    expect(companySlugs('Verein Muster e.V.')).toEqual(['verein-muster', 'vereinmuster']);
  });

  it('generic or too short names give no slug', () => {
    expect(companySlugs('Personalvermittlung')).toEqual([]);
    expect(companySlugs('Arbeitgeber')).toEqual([]);
    expect(companySlugs('Anonym GmbH')).toEqual([]);
    expect(companySlugs('AB')).toEqual([]);
    expect(companySlugs('')).toEqual([]);
  });

  it('nameOnPage: the name without legal form appears in the text', () => {
    expect(nameOnPage('iSAX GmbH & Co. KG', 'Willkommen bei der  ISAX\nGmbH & Co. KG')).toBe(true);
    expect(nameOnPage('Helm & Walter GmbH', 'Impressum Helm   & Walter IT-Solutions')).toBe(true);
    expect(nameOnPage('iSAX GmbH & Co. KG', 'Domain zu verkaufen')).toBe(false);
    expect(nameOnPage('Personalvermittlung', 'Personalvermittlung')).toBe(false);
  });

  it('nameOnPage: a domain is no evidence — parked page (I3)', () => {
    expect(nameOnPage('iSAX GmbH & Co. KG', 'isax.de steht zum Verkauf! Jetzt www.isax.de kaufen. Kontakt: info@isax.de')).toBe(false);
  });

  it('nameOnPage: whole words only, a one-word name needs its legal form or a legal notice (I3)', () => {
    expect(nameOnPage('Data GmbH', 'Wir lieben Big Data und Cloud-Lösungen für den Mittelstand. Impressum: Muster AG, Geschäftsführer Max Mustermann')).toBe(false);
    expect(nameOnPage('Data GmbH', 'Wir lieben Big Data und Cloud.')).toBe(false);
    expect(nameOnPage('Software AG', 'Wir entwickeln Software. Impressum Muster GmbH')).toBe(false);
    expect(nameOnPage('iSAX GmbH & Co. KG', 'Die isaxe sind toll')).toBe(false);
    expect(nameOnPage('iSAX GmbH & Co. KG', 'Impressum\nAngaben gemäß § 5 TMG\niSAX GmbH & Co. KG\nMaxstraße 1\n01067 Dresden')).toBe(true);
    expect(nameOnPage('iSAX GmbH & Co. KG', 'Impressum\nAngaben gemäß § 5 DDG\nVertreten durch: Geschäftsführer der iSAX Verwaltung')).toBe(true);
    expect(nameOnPage('Data GmbH', 'Kontakt: Data GmbH, Hauptstraße 1')).toBe(true);
  });
});

describe('research links: website candidates', () => {
  it('ITsax page: the external link to the company site comes first; board, apply service and social links are not candidates', () => {
    const c = websiteCandidates({
      pageUrl: 'https://www.itsax.de/jobs/303430/fullstack',
      links: [
        link('', 'https://en.itsax.de/jobs/303430/fullstack'),
        link('', 'https://www.symate.de/jobs'),
        link('finden Sie hier', 'https://bms.empfehlungsbund.de/datenschutz#bewerbungsformular'),
        link('', 'https://www.facebook.com/itsax'),
        link('', 'mailto:info@itsax.de'),
      ],
      emails: [],
      company: 'Symate GmbH',
    });
    expect(c[0]).toEqual({ url: 'https://www.symate.de', nameCheck: false });
    const urls = c.map((x) => x.url);
    expect(urls).not.toContain('https://bms.empfehlungsbund.de');
    expect(urls.some((x) => x.includes('itsax') || x.includes('facebook'))).toBe(false);
    expect(c.length).toBeLessThanOrEqual(6);
    expect(new Set(urls.map(siteOf)).size).toBe(c.length);
  });

  it('StepStone page without external links or mail: only guesses from the name', () => {
    const c = websiteCandidates({ pageUrl: 'https://www.stepstone.de/job/12817717', links: [link('Jobs', 'https://www.stepstone.de/jobs/x')], emails: [], company: 'iSAX GmbH & Co. KG' });
    expect(c).toEqual([{ url: 'https://www.isax.de', nameCheck: true }, { url: 'https://www.isax.com', nameCheck: true }]);
  });

  it('a company e-mail gives its domain; free mail does not', () => {
    expect(websiteCandidates({ pageUrl: '', links: [], emails: ['jobs@helmundwalter.de'], company: '' })).toEqual([{ url: 'https://helmundwalter.de', nameCheck: true }]);
    // With the name: the host holds the und-slug, so it is trusted and ranks before the guesses.
    expect(websiteCandidates({ pageUrl: '', links: [], emails: ['jobs@helmundwalter.de'], company: 'Helm & Walter GmbH' })[0])
      .toEqual({ url: 'https://helmundwalter.de', nameCheck: false });
    expect(websiteCandidates({ pageUrl: '', links: [], emails: ['x@gmail.com', 'y@GMX.de'], company: '' })).toEqual([]);
    expect(websiteCandidates({ pageUrl: '', links: [], emails: ['service@stepstone.de'], company: '' })).toEqual([]);
  });

  it('a page on the company site itself is a candidate (not a board, not an apply service)', () => {
    expect(websiteCandidates({ pageUrl: 'https://jobs.hw.ag/', links: [], emails: [], company: '' })).toEqual([{ url: 'https://jobs.hw.ag', nameCheck: false }]);
    expect(websiteCandidates({ pageUrl: 'https://acme.jobs.personio.de/job/1', links: [], emails: [], company: '' })).toEqual([]);
  });

  it('an apply-service page links to the company home like a board does', () => {
    const c = websiteCandidates({ pageUrl: 'https://acme.jobs.personio.de/job/1', links: [link('Website', 'https://www.acme.de/')], emails: [], company: '' });
    expect(c).toEqual([{ url: 'https://www.acme.de', nameCheck: true }]);
  });

  it('a linked site whose host holds the name ranks first and is trusted; others need a name check (R7)', () => {
    const c = websiteCandidates({
      pageUrl: 'https://www.stepstone.de/job/1',
      links: [link('', 'https://www.agentur-x.de/'), link('', 'https://karriere.muster.de/'), link('', 'https://www.stepstone.at/x'),
        link('', 'https://www.kununu.com/de/muster'), link('', 'https://www.thestepstonegroup.com/')],
      emails: [], company: 'Muster GmbH',
    });
    expect(c[0]).toEqual({ url: 'https://karriere.muster.de', nameCheck: false });
    expect(c).toContainEqual({ url: 'https://www.agentur-x.de', nameCheck: true });
    expect(c.map((x) => x.url).some((u) => u.includes('stepstone') || u.includes('kununu'))).toBe(false);
  });

  it('never returns links with a login, non-http links or more than 6', () => {
    const many = Array.from({ length: 10 }, (_, i) => link('', `https://firm${i}.de/`));
    const c = websiteCandidates({
      pageUrl: 'https://www.stepstone.de/job/1',
      links: [link('', 'https://user:pass@evil.de/'), link('', 'ftp://files.de/'), link('', 'javascript:alert(1)'), ...many],
      emails: [], company: 'Muster GmbH',
    });
    expect(c.some((x) => x.url.includes('evil') || x.url.includes('files'))).toBe(false);
    expect(c).toHaveLength(6);
    // Ten unchecked board links do not push out the guesses from the name.
    expect(c).toContainEqual({ url: 'https://www.muster.de', nameCheck: true });
    expect(c).toContainEqual({ url: 'https://www.muster.com', nameCheck: true });
    expect(c.filter((x) => x.url.startsWith('https://firm')).every((x) => x.nameCheck)).toBe(true);
  });
});

describe('research links: next pages', () => {
  it('same site, or job pages on an apply service (never the Impressum of the service), by priority; no mailto/tel/ignored/seen/login', () => {
    const pages = nextPages('https://www.symate.de', [
      link('Über uns', 'https://www.symate.de/ueber-uns'),
      link('Jobs', 'https://symate.de/jobs'),
      link('Bewerben', 'https://symate.jobs.personio.de/job/42'),
      link('Kontakt', 'https://www.symate.de/kontakt#form'),
      link('Impressum', 'https://www.symate.de/impressum'),
      link('Facebook', 'https://www.facebook.com/symate'),
      link('Impressum', 'https://bms.empfehlungsbund.de/impressum'),
      link('Kontakt', 'https://other.de/kontakt'),
      link('info@symate.de', 'mailto:info@symate.de'),
      link('Anrufen', 'tel:+4935182126300'),
      link('Kontakt', 'https://u:p@www.symate.de/kontakt2'),
      link('Startseite', 'https://www.symate.de/'),
      link('Impressum', 'https://www.symate.de/impressum#top'),
    ], new Set(['https://symate.de/jobs']));
    expect(pages).toEqual([
      { url: 'https://www.symate.de/impressum', kind: 'impressum' },
      { url: 'https://www.symate.de/kontakt', kind: 'contact' },
      { url: 'https://symate.jobs.personio.de/job/42', kind: 'apply' },
      { url: 'https://www.symate.de/ueber-uns', kind: 'about' },
    ]);
  });

  it('a privacy link with an application #fragment is not a next page (I1)', () => {
    const pages = nextPages('https://www.symate.de', [
      link('finden Sie hier', 'https://bms.empfehlungsbund.de/datenschutz#bewerbungsformular'),
      link('Datenschutz', 'https://www.symate.de/datenschutz#bewerbung'),
    ], new Set());
    expect(pages).toEqual([]);
  });
});
