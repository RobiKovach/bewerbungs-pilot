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

  it('takes the name from the vacancy page before the Impressum, and nothing at all from no pages', () => {
    const pages = [
      page({ url: 'https://firma.de/impressum', kind: 'impressum', text: 'Geschäftsführer: Herr Hans Chef\nE-Mail: info@firma.de' }),
      page({ url: 'https://www.itsax.de/jobs/1', kind: 'vacancy', text: 'Ihr Ansprechpartner\nHerr Martin Juhrisch\nTel.: +49 351 82126-300' }),
    ];
    const c = contactFromPages(pages, 'https://firma.de');
    expect(c).toMatchObject({ name: 'Martin Juhrisch', salutation: 'Herr', phone: '+49 351 82126-300', email: 'info@firma.de' });
    expect(contactFromPages([], 'https://firma.de')).toEqual(empty);
  });
});
