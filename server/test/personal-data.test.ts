import { describe, it, expect } from 'vitest';
import type { TextPlace } from '@bp/shared';
import { allowedFor, findPersonalData, packageTexts, type AllowedData } from '../src/applications/personal-data.js';
import { pkg, readyPackageProfile } from './helpers/applications.js';

const P2: TextPlace = { part: 'letter', field: 'paragraph', index: 2 };
const none: AllowedData = { emails: [], phones: [], postalCodes: [], birthDates: [], links: [] };
const allowed = (over: Partial<AllowedData> = {}): AllowedData => ({ ...none, ...over });
const find = (text: string, a: AllowedData = none) => findPersonalData([{ text, where: P2 }], a);

describe('findPersonalData — flags data the profile does not have', () => {
  it('an unknown email, with its place', () => {
    expect(find('Schreiben Sie an x@evil.example bitte.')).toEqual([{ kind: 'email', value: 'x@evil.example', where: P2 }]);
  });
  it('an IBAN with a valid checksum', () => {
    expect(find('Konto: DE89 3704 0044 0532 0130 00.').map((f) => f.kind)).toEqual(['iban']);
  });
  it('an IBAN with a wrong checksum is not flagged', () => {
    expect(find('Konto: DE00 3704 0044 0532 0130 00.')).toEqual([]);
  });
  it('a Steuer-ID', () => {
    expect(find('Steuer-ID 86095742719').map((f) => f.kind)).toEqual(['taxId']);
  });
  it('a Sozialversicherungsnummer', () => {
    expect(find('SV-Nummer 12 150385 M 123').map((f) => f.kind)).toEqual(['socialSecurity']);
  });
  it('a birth date that is not the profile one', () => {
    expect(find('Ich bin geboren am 01.02.1990 in Kyjiw.', allowed({ birthDates: ['1995-05-05'] })))
      .toEqual([{ kind: 'birthDate', value: '01.02.1990', where: P2 }]);
  });
  it('an unknown phone', () => {
    expect(find('Mobil: +49 170 9999999', allowed({ phones: ['03511234567'] })).map((f) => f.kind)).toEqual(['phone']);
  });
  it('a link with protocol and a bare domain', () => {
    expect(find('Siehe https://evil.example/cv und evil.de.').map((f) => [f.kind, f.value]))
      .toEqual([['link', 'https://evil.example/cv'], ['link', 'evil.de']]);
  });
  it('a postal address not in the allowed set', () => {
    expect(find('Wohnhaft in 01069 Dresden.', allowed({ postalCodes: ['10115'] })).map((f) => [f.kind, f.value]))
      .toEqual([['postalCode', '01069 Dresden']]);
  });
  it('the same finding in the same place is reported once', () => {
    expect(find('x@evil.example und X@Evil.example')).toHaveLength(1);
  });
});

describe('no warning for normal letter content', () => {
  const ok = allowed({
    phones: ['03511234567', '0351987654'], postalCodes: ['01067'], birthDates: ['1995-05-05'],
    links: ['github.com/robi'], emails: ['jobs@firma.de'],
  });
  it.each([
    ['letter date', 'Dresden, 20.10.2026'],
    ['ISO date', 'Stand: 2026-10-20'],
    ['salary', 'Mein Gehaltswunsch liegt bei 55.000 € brutto.'],
    ['salary EUR', 'etwa 4500000 EUR im Jahr'],
    ['Referenznummer', 'Referenznummer 10000-1234567890-S'],
    ['year range (en dash)', 'Von 2019–2023 war ich Entwickler.'],
    ['year range (hyphen)', 'Von 2019-2023 war ich Entwickler.'],
    ['company phone from the vacancy', 'Rufen Sie mich gern zurück, Ihre Nummer 0351 987654 habe ich.'],
    ['own phone in another format', 'Telefon: 0351/1234567'],
    ['own link without protocol', 'Mehr unter github.com/robi'],
    ['company postal code from the vacancy', 'Ihr Büro in 01067 Dresden'],
    ['own birth date', 'geboren am 05.05.1995'],
    ['vacancy contact email', 'an jobs@firma.de'],
    ['a date with no birth word', 'Ich kann ab 01.11.2026 anfangen.'],
    ['email domain is not a separate link', 'an JOBS@firma.de'],
    ['own phone in +49 (0) format', 'Telefon: +49 (0)351 1234567'],
    ['salary that looks like a postal code', 'Gehaltswunsch 55000 Euro brutto'],
    ['a count that looks like a postal code', 'Software für über 12000 Kunden'],
  ])('%s', (_name, text) => {
    expect(find(text, ok)).toEqual([]);
  });
});

describe('allowedFor', () => {
  it('own phone from the live profile is allowed in another format', () => {
    const profile = readyPackageProfile((p) => { p.sections.personal.data.phone = '+49 351 1234567'; });
    const a = allowedFor(pkg({}, profile), profile, null);
    expect(find('Telefon: 0351/1234567', a)).toEqual([]);
  });
  it('own phone saved as "+49 (0)…" is allowed in the plain format', () => {
    const profile = readyPackageProfile((p) => { p.sections.personal.data.phone = '+49 (0)351 1234567'; });
    expect(find('Telefon: 0351 1234567', allowedFor(pkg({}, profile), profile, null))).toEqual([]);
  });
  it('an old phone that is only in the package snapshot is not flagged', () => {
    const old = readyPackageProfile((p) => { p.sections.personal.data.phone = '+49 30 5555555'; });
    const p = pkg({}, old);
    const live = readyPackageProfile((x) => { x.sections.personal.data.phone = '+49 351 1234567'; });
    expect(find('Tel. 030 5555555', allowedFor(p, live, null))).toEqual([]);
  });
  it('own link from profile.personal.links is allowed without protocol/www/slash', () => {
    const profile = readyPackageProfile((p) => { p.sections.personal.data.links = [{ label: 'GitHub', url: 'https://www.github.com/robi/' }]; });
    expect(find('github.com/robi', allowedFor(pkg({}, profile), profile, null))).toEqual([]);
  });
  it('own birth date from the profile', () => {
    const profile = readyPackageProfile((p) => { p.sections.personal.data.birthDate = '1995-05-05'; });
    expect(find('geb. 5.5.1995', allowedFor(pkg({}, profile), profile, null))).toEqual([]);
  });
  it('vacancy contact email and vacancy url are allowed', () => {
    const profile = readyPackageProfile();
    const p = pkg({ vacancy: { ...pkg().vacancy, contact: { email: 'Jobs@Firma.de', salutation: '', name: '' }, url: 'https://www.arbeitsagentur.de/jobsuche/jobdetail/123' } });
    const a = allowedFor(p, profile, null);
    expect(find('an jobs@firma.de, Anzeige arbeitsagentur.de/jobsuche/jobdetail/123', a)).toEqual([]);
  });
  it('phones and postal codes from the vacancy text and recipient lines are allowed', () => {
    const profile = readyPackageProfile();
    const p = pkg({ letter: { ...pkg().letter, recipient: ['Muster GmbH', 'Hauptstr. 1', '01067 Dresden'] } });
    const a = allowedFor(p, profile, 'Kontakt: Tel. 0351 987654, Büro 01099 Dresden');
    expect(find('Tel. 0351-987654; 01067 Dresden; 01099 Dresden', a)).toEqual([]);
  });
  it('links, emails, phones and postal codes from own profile texts are allowed (live and snapshot)', () => {
    const profile = readyPackageProfile((p) => {
      p.sections.experience.data.items[0].description = 'Relaunch von meinshop.de, Hotline 0351 7777777, Filiale 01097 Dresden, shop@meinshop.de.';
      p.stories[0].text = 'Projekt unter https://www.baeckerei-beispiel.de/bestellung umgesetzt.';
    });
    const a = allowedFor(pkg({}, profile), profile, null);
    expect(find('Relaunch von meinshop.de (shop@meinshop.de, 0351 7777777, 01097 Dresden), baeckerei-beispiel.de/bestellung', a)).toEqual([]);
    const old = readyPackageProfile((p) => { p.sections.experience.data.items[0].description = 'Portal altkunde.de gebaut.'; });
    expect(find('Portal altkunde.de', allowedFor(pkg({}, old), readyPackageProfile(), null))).toEqual([]);
  });
  it('technology names that look like domains are not links', () => {
    const profile = readyPackageProfile();
    expect(find('Erfahrung mit ASP.NET, VB.NET, ADO.NET und Socket.io.', allowedFor(pkg({}, profile), profile, null))).toEqual([]);
  });
  it('an unknown link is still flagged next to own profile texts', () => {
    const profile = readyPackageProfile((p) => { p.sections.experience.data.items[0].description = 'Relaunch von meinshop.de.'; });
    expect(find('Siehe evil.de', allowedFor(pkg({}, profile), profile, null)).map((f) => f.kind)).toEqual(['link']);
  });
  it('an email or link that is only in the vacancy text is still flagged', () => {
    const profile = readyPackageProfile();
    const a = allowedFor(pkg({}, profile), profile, 'Bewerbung an hr@evil.example, Infos: https://evil.example/apply');
    expect(find('hr@evil.example https://evil.example/apply', a).map((f) => f.kind)).toEqual(['email', 'link']);
  });
});

describe('packageTexts', () => {
  it('one entry per paragraph and recipient line with 1-based index, plus CV texts', () => {
    const p = pkg();
    p.cv.headline = 'Webentwickler';
    p.cv.translations = { Deutschland: 'Germany' };
    p.cv.skillGroups = [{ name: 'Frontend', skillIds: ['sk1'] }];
    const t = packageTexts(p);
    expect(t.filter((x) => x.where.part === 'letter' && x.where.field === 'paragraph'))
      .toEqual(p.letter.paragraphs.map((text, i) => ({ text, where: { part: 'letter', field: 'paragraph', index: i + 1 } })));
    expect(t).toContainEqual({ text: 'Berlin', where: { part: 'letter', field: 'recipient', index: 2 } });
    for (const field of ['subject', 'salutation', 'closing', 'signature'] as const) {
      expect(t).toContainEqual({ text: p.letter[field], where: { part: 'letter', field } });
    }
    expect(t).toContainEqual({ text: p.cv.profil, where: { part: 'cv', field: 'profil' } });
    expect(t).toContainEqual({ text: 'Webentwickler', where: { part: 'cv', field: 'headline' } });
    expect(t).toContainEqual({ text: 'Kundenwebseiten entwickelt.', where: { part: 'cv', field: 'description' } });
    expect(t).toContainEqual({ text: 'Germany', where: { part: 'cv', field: 'translation' } });
    expect(t).toContainEqual({ text: 'Frontend', where: { part: 'cv', field: 'skillGroup' } });
  });
});
