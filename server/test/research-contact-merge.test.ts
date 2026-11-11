import type { VacancyContact } from '@bp/shared';
import { describe, expect, it } from 'vitest';
import { contactFromPages, mergeContact, type FoundPage } from '../src/research/contact-merge.js';

const empty: VacancyContact = { email: '', salutation: '', name: '', phone: '', street: '', postcode: '', city: '' };
const page = (p: Partial<FoundPage> & Pick<FoundPage, 'url' | 'kind'>): FoundPage => ({ text: '', links: [], ...p });
const mailto = (address: string, text = address) => ({ text, href: `mailto:${address}` });

describe('research contact: merge without overwriting', () => {
  it('never overwrites a filled field; differing lists the other value', () => {
    const current = { ...empty, email: 'personal@firma.de', name: 'Erika Muster', salutation: 'Frau' as const };
    const found = { ...empty, email: 'jobs@firma.de', name: 'Max Muster', salutation: 'Herr' as const, phone: '0351 123456' };
    const r = mergeContact(current, found, undefined);
    expect(r.contact).toMatchObject({ email: 'personal@firma.de', name: 'Erika Muster', salutation: 'Frau', phone: '0351 123456' });
    expect(r.differing).toEqual({ email: 'jobs@firma.de', name: 'Max Muster', salutation: 'Herr' });
    expect(r.auto).toEqual(['phone']);
  });

  it('fills only empty fields and marks them auto', () => {
    const found = { ...empty, email: 'jobs@helmundwalter.de', phone: '0351 79903521', street: 'Einsteinstraße 6', postcode: '01069', city: 'Dresden' };
    const r = mergeContact(null, found, undefined);
    expect(r.contact).toEqual(found);
    expect(r.auto).toEqual(['email', 'phone', 'street', 'postcode', 'city']);
    expect(r.differing).toEqual({});
  });

  it('keeps earlier auto marks, ignores the same value written differently, fills a salutation only with its name', () => {
    const current = { ...empty, email: 'Jobs@Firma.de', phone: '+49 351 123456' };
    const found = { ...empty, email: 'jobs@firma.de', phone: '+49351123456', name: 'Erika Muster', salutation: 'Frau' as const };
    const r = mergeContact(current, found, ['email']);
    expect(r.differing).toEqual({});
    expect(r.contact).toMatchObject({ email: 'Jobs@Firma.de', phone: '+49 351 123456', name: 'Erika Muster', salutation: 'Frau' });
    expect(r.auto).toEqual(['email', 'salutation', 'name']);
    // A name already there: a found salutation alone never lands in the contact.
    const named = mergeContact({ ...empty, name: 'Erika Muster' }, { ...empty, name: 'Erika Muster', salutation: 'Frau' }, undefined);
    expect(named.contact?.salutation).toBe('');
    expect(named.auto).toEqual([]);
  });

  it('a found name whose salutation contradicts the card goes to differing; the card keeps its salutation', () => {
    const r = mergeContact({ ...empty, salutation: 'Herr' }, { ...empty, name: 'Erika Muster', salutation: 'Frau', email: 'jobs@firma.de' }, undefined);
    expect(r.contact).toMatchObject({ salutation: 'Herr', name: '', email: 'jobs@firma.de' });
    expect(r.differing).toEqual({ name: 'Erika Muster', salutation: 'Frau' });
    expect(r.auto).toEqual(['email']);
    // Same salutation on the card: the name is filled, the salutation stays the person's own (not marked auto).
    const same = mergeContact({ ...empty, salutation: 'Frau' }, { ...empty, name: 'Erika Muster', salutation: 'Frau' }, undefined);
    expect(same.contact).toMatchObject({ salutation: 'Frau', name: 'Erika Muster' });
    expect(same.auto).toEqual(['name']);
    expect(same.differing).toEqual({});
  });

  it('nothing found and nothing there → null contact', () => {
    expect(mergeContact(null, empty, undefined)).toEqual({ contact: null, auto: [], differing: {} });
  });
});

describe('research contact: from pages', () => {
  const site = 'https://helmundwalter.de';

  it('mailto on the apply page wins over info@ in the Impressum', () => {
    const pages = [
      page({ url: 'https://helmundwalter.de/impressum', kind: 'impressum', text: 'Impressum\nHelm & Walter IT-Solutions GmbH\nEinsteinstraße 6\n01069 Dresden\nTel.: +49 351 799 035 0\nE-Mail: info@helmundwalter.de', links: [mailto('info@helmundwalter.de')] }),
      page({
        url: 'https://helmundwalter.de/jobs', kind: 'apply', text: 'Webentwickler Fullstack (m/w/d)\nJetzt bewerben',
        links: [mailto('jobs@helmundwalter.de?subject=Bewerbung:%20Webentwickler', 'Jetzt bewerben'), { text: '0351 79903521', href: 'tel:0351 79903521' }],
      }),
    ];
    const c = contactFromPages(pages, site);
    expect(c.email).toBe('jobs@helmundwalter.de');
    expect(c.phone).toBe('0351 79903521');
    expect(c).toMatchObject({ street: 'Einsteinstraße 6', postcode: '01069', city: 'Dresden' });
  });

  it('board e-mail (service@stepstone.de) is not taken', () => {
    const pages = [page({
      url: 'https://www.stepstone.de/job/12817717', kind: 'vacancy',
      text: 'Senior Software-Entwickler (m/w/d)\nFragen? service@stepstone.de\nBewerbungen an karriere@isax.com',
      links: [mailto('service@stepstone.de'), mailto('support@jobs.personio.de')],
    })];
    expect(contactFromPages(pages, 'https://isax.com').email).toBe('karriere@isax.com');
  });

  it('a page with 40 mailto links yields at most 5 candidates and picks the apply one', () => {
    const team = Array.from({ length: 40 }, (_, i) => mailto(`person${i}@firma.de`));
    team.splice(2, 0, mailto('bewerbung@firma.de'));
    team.splice(30, 0, mailto('jobs@firma.de'));
    const pages = [page({ url: 'https://firma.de/team', kind: 'about', links: team })];
    // jobs@ at position 31 is past the 5 candidates; bewerbung@ within them wins over person0@.
    expect(contactFromPages(pages, 'https://firma.de').email).toBe('bewerbung@firma.de');
    const onlyLate = [page({ url: 'https://firma.de/team', kind: 'about', links: [...Array.from({ length: 6 }, (_, i) => mailto(`p${i}@firma.de`)), mailto('jobs@firma.de')] })];
    expect(contactFromPages(onlyLate, 'https://firma.de').email).toBe('p0@firma.de');
  });

  it('drops privacy, noreply and webmaster addresses; info@ only when nothing better', () => {
    const pages = [
      page({ url: 'https://firma.de/kontakt', kind: 'contact', links: [mailto('datenschutz@firma.de'), mailto('noreply@firma.de'), mailto('webmaster@firma.de'), mailto('info@firma.de'), mailto('personal@firma.de')] }),
    ];
    expect(contactFromPages(pages, 'https://firma.de').email).toBe('personal@firma.de');
    const onlyInfo = [page({ url: 'https://firma.de/kontakt', kind: 'contact', links: [mailto('privacy@firma.de'), mailto('info@firma.de')] })];
    expect(contactFromPages(onlyInfo, 'https://firma.de').email).toBe('info@firma.de');
  });

  it('ITsax: name and phone from the ad’s contact block on the board, e-mail and address from the company site', () => {
    const pages = [
      page({ url: 'https://symate.de/impressum', kind: 'impressum', text: 'Geschäftsführer: Herr Hans Chef\nSymate GmbH\nAm Lagerplatz 8\n01099 Dresden\nE-Mail: info@symate.de' }),
      page({
        url: 'https://www.itsax.de/jobs/1', kind: 'vacancy',
        text: 'itsax.de – Jobs in Sachsen\nSoftwareentwickler (m/w/d)\nIhr Ansprechpartner\nHerr Martin Juhrisch\nTel.: +49 351 82126-300\n\nFußzeile\nitsax.de\nHauptstraße 1\n01097 Dresden',
      }),
    ];
    const c = contactFromPages(pages, 'https://symate.de');
    expect(c).toEqual({ ...empty, name: 'Martin Juhrisch', salutation: 'Herr', phone: '+49 351 82126-300', email: 'info@symate.de', street: 'Am Lagerplatz 8', postcode: '01099', city: 'Dresden' });
    expect(contactFromPages([], 'https://symate.de')).toEqual(empty);
  });

  it('a name only in the Impressum (managing director) or on a news page is never taken', () => {
    const pages = [page({ url: 'https://firma.de/impressum', kind: 'impressum', text: 'Geschäftsführer: Herr Hans Chef\nE-Mail: info@firma.de' })];
    expect(contactFromPages(pages, 'https://firma.de')).toMatchObject({ name: '', salutation: '', email: 'info@firma.de' });
    const news = [page({ url: 'https://firma.de/news/1', kind: 'news', text: 'Ansprechpartner: Frau Eva Presse\nE-Mail: presse@firma.de' })];
    expect(contactFromPages(news, 'https://firma.de')).toMatchObject({ name: '', email: '' });
  });

  it('a board page without a contact block gives no phone and no address (hotline in the footer)', () => {
    const pages = [page({
      url: 'https://www.stepstone.de/job/1', kind: 'vacancy',
      text: 'Senior Entwickler (m/w/d)\nWir freuen uns auf Sie.\nHotline: Tel. 0800 1234567\nStepStone Deutschland GmbH\nVölklinger Straße 1\n40219 Düsseldorf',
      links: [{ text: '0800 1234567', href: 'tel:08001234567' }],
    })];
    expect(contactFromPages(pages, 'https://firma.de')).toEqual(empty);
  });

  it('the company’s own domain (or a subdomain) wins over an agency e-mail in the footer', () => {
    const pages = [page({
      url: 'https://firma.de/karriere', kind: 'careers',
      text: 'Karriere\nBewerbung an jobs@firma.de\nWebdesign: info@agentur.de',
      links: [mailto('info@agentur.de'), mailto('jobs@firma.de')],
    })];
    expect(contactFromPages(pages, 'https://firma.de').email).toBe('jobs@firma.de');
    const sub = [page({ url: 'https://firma.de/karriere', kind: 'careers', links: [mailto('bewerbung@agentur.de'), mailto('info@karriere.firma.de')] })];
    expect(contactFromPages(sub, 'https://firma.de').email).toBe('info@karriere.firma.de');
  });
});
