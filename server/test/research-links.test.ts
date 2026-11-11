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

  it('siteOf compares without www.', () => {
    expect(siteOf('https://www.symate.de/jobs')).toBe('https://symate.de');
    expect(siteOf('http://symate.de')).toBe('https://symate.de');
    expect(siteOf('not a url')).toBe('');
  });
});

describe('research links: company slugs and name on page', () => {
  it('drops the legal form, umlauts and punctuation; hyphen and joined forms', () => {
    expect(companySlugs('iSAX GmbH & Co. KG')).toEqual(['isax']);
    expect(companySlugs('Helm & Walter GmbH')).toEqual(['helm-walter', 'helmwalter']);
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
    expect(c[0]).toBe('https://www.symate.de');
    expect(c).not.toContain('https://bms.empfehlungsbund.de');
    expect(c.some((x) => x.includes('itsax') || x.includes('facebook'))).toBe(false);
    expect(c.length).toBeLessThanOrEqual(6);
    expect(new Set(c.map(siteOf)).size).toBe(c.length);
  });

  it('StepStone page without external links or mail: only guesses from the name', () => {
    const c = websiteCandidates({ pageUrl: 'https://www.stepstone.de/job/12817717', links: [link('Jobs', 'https://www.stepstone.de/jobs/x')], emails: [], company: 'iSAX GmbH & Co. KG' });
    expect(c).toEqual(['https://www.isax.de', 'https://www.isax.com']);
  });

  it('a company e-mail gives its domain; free mail does not', () => {
    expect(websiteCandidates({ pageUrl: '', links: [], emails: ['jobs@helmundwalter.de'], company: '' })).toEqual(['https://helmundwalter.de']);
    expect(websiteCandidates({ pageUrl: '', links: [], emails: ['x@gmail.com', 'y@GMX.de'], company: '' })).toEqual([]);
    expect(websiteCandidates({ pageUrl: '', links: [], emails: ['service@stepstone.de'], company: '' })).toEqual([]);
  });

  it('a page on the company site itself is a candidate (not a board, not an apply service)', () => {
    expect(websiteCandidates({ pageUrl: 'https://jobs.hw.ag/', links: [], emails: [], company: '' })).toEqual(['https://jobs.hw.ag']);
    expect(websiteCandidates({ pageUrl: 'https://acme.jobs.personio.de/job/1', links: [], emails: [], company: '' })).toEqual([]);
  });

  it('an apply-service page links to the company home like a board does', () => {
    const c = websiteCandidates({ pageUrl: 'https://acme.jobs.personio.de/job/1', links: [link('Website', 'https://www.acme.de/')], emails: [], company: '' });
    expect(c).toEqual(['https://www.acme.de']);
  });

  it('never returns links with a login, non-http links or more than 6', () => {
    const many = Array.from({ length: 10 }, (_, i) => link('', `https://firm${i}.de/`));
    const c = websiteCandidates({
      pageUrl: 'https://www.stepstone.de/job/1',
      links: [link('', 'https://user:pass@evil.de/'), link('', 'ftp://files.de/'), link('', 'javascript:alert(1)'), ...many],
      emails: [], company: 'Muster GmbH',
    });
    expect(c.some((x) => x.includes('evil') || x.includes('files'))).toBe(false);
    expect(c).toHaveLength(6);
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
});
