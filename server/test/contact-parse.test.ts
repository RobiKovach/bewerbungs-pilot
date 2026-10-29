import { describe, it, expect } from 'vitest';
import { emptyContact, NAME_WINDOW_CHARS, nameWindow, needsName, parseContact } from '../src/vacancies/contact-parse.js';
import { contactNameTask, withContactName } from '../src/vacancies/tasks/contact-name.js';

// Fixtures follow the structure of real Arbeitsagentur pages read in the B1 live checks; every name, address, e-mail
// and number is made up.

const OFFER_HEAD = `Zur Jobsuche Startseite
Stellenangebot:
KI-First Infrastructure Consultant (m/w/d)
bei
Mustertech Germany Experts GmbH
Das Wichtigste im Überblick
Arbeitsort
Dresden
Beginn
ab sofort
Veröffentlichungsdatum:
Vor 2 Tagen veröffentlicht
Stellenbeschreibung
Du begleitest Kunden ab 01.11.2026 bei der Einführung von KI-Werkzeugen. Gehalt 3.500 - 4.200 € brutto.
Arbeitsorte
Karte anzeigen
01099 Dresden
Unternehmensdarstellung:
Mustertech Germany Experts GmbH
Webseiten
Homepage`;

const FOOTER = `Fußbereich
Stelle betreut durch Arbeitgeber
Referenz-Nr.: 12345-BB-123456-7878-3444-S
Verstoß melden`;

/** After the captcha: company, a person without Frau/Herr, an e-mail; the internal job number looks like a phone. */
const AA_NAME_EMAIL = `${OFFER_HEAD}
Informationen zur Bewerbung
Kontaktadresse

MUSTERTECH
Erika Musterfrau

E-Mail: Erika.Musterfrau@mustertech.example

Bewerben Sie sich:
Über Internetseite des Arbeitgebers

Bitte bewerben Sie sich unter Angabe unserer internen Stellennummer: JN -082026-81125

${FOOTER}`;

/** After the captcha: only a link to the employer's website. */
const AA_LINK_ONLY = `${OFFER_HEAD}
Quelle/Bewerbung via: https://www.jobboard.example/jobs/303723/softwareentwickler
Informationen zur Bewerbung
Bewerben Sie sich:
Über Internetseite des Arbeitgebers
${FOOTER}`;

/** Before the captcha: the page talks about "Kontaktdaten", which is not a contact. */
const AA_CAPTCHA = `${OFFER_HEAD}
Informationen zur Bewerbung
Sicherheitsabfrage

Wir schützen die Kontaktdaten des Arbeitgebers vor unerlaubten Zugriffen. Bitte geben Sie die dargestellten Zeichen in das Textfeld ein, um die Kontaktdaten des Arbeitgebers anzuzeigen.

Anderes Bild laden
Dargestellte Zeichen
Absenden
${FOOTER}`;

const PARTNER_PAGE = `Karriere bei Muster Software
Wir suchen dich als Webentwickler (m/w/d). Bewerbungen bitte bis 30.11.2026.

Ihr Kontakt
Frau Dr. Erika Musterfrau
Personalabteilung
Muster Software GmbH
Musterstraße 12
01069 Dresden
Tel.: +49 (0)351 123 456-78
E-Mail: karriere@muster-software.example

Impressum · Datenschutz · noreply@muster-software.example`;

describe('parseContact', () => {
  it('AA block with a name without salutation and an e-mail; the job number is not a phone', () => {
    const { contact, found } = parseContact(AA_NAME_EMAIL);
    expect(contact).toEqual({
      ...emptyContact(), name: 'Erika Musterfrau', email: 'Erika.Musterfrau@mustertech.example',
    });
    expect(found).toEqual(['email', 'name']);
  });

  it('AA link-only block: nothing — not the work place postcode, not the reference number', () => {
    expect(parseContact(AA_LINK_ONLY)).toEqual({ contact: emptyContact(), found: [] });
  });

  it('captcha page: "Kontaktdaten" in a sentence is no contact heading', () => {
    expect(parseContact(AA_CAPTCHA)).toEqual({ contact: emptyContact(), found: [] });
  });

  it('partner page: salutation with title, name on one line, address, labelled phone, e-mail (not noreply)', () => {
    const { contact, found } = parseContact(PARTNER_PAGE);
    expect(contact).toEqual({
      email: 'karriere@muster-software.example', salutation: 'Frau', name: 'Dr. Erika Musterfrau',
      phone: '+49 (0)351 123 456-78', street: 'Musterstraße 12', postcode: '01069', city: 'Dresden',
    });
    expect(found).toEqual(['email', 'salutation', 'name', 'phone', 'street', 'postcode', 'city']);
  });

  it('a heading with the contact on the same line', () => {
    const { contact } = parseContact('Ansprechpartner: Herr Max Mustermann, Telefon 0351 4711-0');
    expect(contact).toMatchObject({ salutation: 'Herr', name: 'Max Mustermann', phone: '0351 4711-0' });
  });

  it('no contact at all → all empty', () => {
    expect(parseContact('Wir suchen einen Webentwickler (m/w/d) in Vollzeit. Bewirb dich jetzt!')).toEqual({ contact: emptyContact(), found: [] });
    expect(parseContact('')).toEqual({ contact: emptyContact(), found: [] });
  });

  it('phone false positives are not taken: dates, salary, reference numbers, Kennziffer, Fax', () => {
    const text = [
      'Beginn 01.11.2026, Bewerbungsschluss 15.12.2026',
      'Gehalt: 3.500 - 4.200 € brutto, 45.000 EUR im Jahr',
      'Referenznummer 10001-1003093507-S, Kennziffer 0351-2026-17',
      'Stellennummer: +49 2026 1234 5678',
      'Fax: +49 351 1234568',
      'Ref-0351123456',
    ].join('\n');
    expect(parseContact(text).contact.phone).toBe('');
  });

  it('phone without a block: labelled German forms or an unlabelled +49 number', () => {
    expect(parseContact('Fragen? Telefon: 0351 / 123 45 67').contact.phone).toBe('0351 / 123 45 67');
    expect(parseContact('Ruf uns an: +49 351 1234567').contact.phone).toBe('+49 351 1234567');
    expect(parseContact('Mobil 0171-1234567 (ab 9 Uhr)').contact.phone).toBe('0171-1234567');
    expect(parseContact('Wir sind unter 0351 1234567 erreichbar').contact.phone).toBe('');
  });

  it('e-mail: skips noreply and Arbeitsagentur addresses', () => {
    expect(parseContact('noreply@firma.example\nfoo@arbeitsagentur.de\njobs@firma.example').contact.email).toBe('jobs@firma.example');
    expect(parseContact('Schreib an info@firma.example.').contact.email).toBe('info@firma.example');
  });

  it('address without a block only as a full street + postcode + city', () => {
    expect(parseContact('Arbeitsort: 01099 Dresden').contact).toEqual(emptyContact());
    expect(parseContact('Muster GmbH, Musterweg 5, 01099 Dresden').contact).toMatchObject({ street: 'Musterweg 5', postcode: '01099', city: 'Dresden' });
  });

  it('a company or department line is no name', () => {
    const { contact } = parseContact('Kontakt\nMuster Software GmbH\nPersonal Service\nE-Mail: jobs@muster.example');
    expect(contact.name).toBe('');
    expect(contact.email).toBe('jobs@muster.example');
  });

  it('cuts fields to their limits', () => {
    const long = `Kontakt\nTel.: +49 ${'1 '.repeat(30)}2`;
    expect(parseContact(long).contact.phone.length).toBeLessThanOrEqual(40);
  });
});

describe('needsName / nameWindow', () => {
  it('AI only when an e-mail or phone was found but no name', () => {
    expect(needsName(parseContact('Kontakt\nE-Mail: jobs@muster.example'))).toBe(true);
    expect(needsName(parseContact('Tel.: 0351 1234567'))).toBe(true);
    expect(needsName(parseContact(AA_NAME_EMAIL))).toBe(false);
    expect(needsName(parseContact(AA_LINK_ONLY))).toBe(false);
  });

  it('window of at most 2 000 characters around the block, or around the e-mail', () => {
    const filler = 'x'.repeat(5000);
    const text = `${filler}\nKontakt\nE-Mail: jobs@muster.example\n${filler}`;
    const w = nameWindow(text, parseContact(text).contact);
    expect(w.length).toBe(NAME_WINDOW_CHARS);
    expect(w).toContain('jobs@muster.example');
    const noBlock = `${filler} Schreib an jobs@muster.example ${filler}`;
    expect(nameWindow(noBlock, parseContact(noBlock).contact)).toContain('jobs@muster.example');
  });
});

describe('contact-name task', () => {
  const window = 'Kontakt\nIhre Ansprechpartnerin ist Erika Musterfrau.\nE-Mail: jobs@muster.example';

  it('strict schema, prompt fences the window and cuts it to 2 000 characters', () => {
    const task = contactNameTask(`${window}${'y'.repeat(5000)}`, 'de');
    expect(task.id).toBe('contact-name');
    expect(task.schema).toMatchObject({ additionalProperties: false, required: ['salutation', 'name'] });
    expect(task.prompt).toContain('UNTRUSTED_CONTACT_BLOCK_');
    expect(task.prompt).not.toContain('y'.repeat(NAME_WINDOW_CHARS));
  });

  it('keeps only a name that literally stands in the window; salutation only with it', () => {
    const base = { ...emptyContact(), email: 'jobs@muster.example' };
    expect(withContactName(base, { salutation: 'Frau', name: 'Erika Musterfrau' }, window)).toMatchObject({ salutation: 'Frau', name: 'Erika Musterfrau' });
    expect(withContactName(base, { salutation: 'Frau', name: 'erika  musterfrau' }, window).name).toBe('erika musterfrau');
    expect(withContactName(base, { salutation: 'Herr', name: 'Max Mustermann' }, window)).toEqual(base);
    expect(withContactName(base, { salutation: 'Frau', name: '' }, window)).toEqual(base);
  });
});

const MENU_PAGE = `Startseite
Über uns
Kontakt
Unsere Standorte
Karriere

Webentwickler (m/w/d) in Dresden
Wir suchen Verstärkung für unser Team. Deine Aufgaben: Websites bauen und pflegen.
${'Wir arbeiten agil, modern und mit viel Freude an guten Lösungen. '.repeat(12)}

Kontakt
Frau Erika Musterfrau
Telefon: 0351 1234567
E-Mail: erika.musterfrau@muster.example`;

describe('partner pages with "Kontakt" in the menu', () => {
  it('the menu heading is skipped; the footer block with the contact wins', () => {
    expect(parseContact(MENU_PAGE).contact).toMatchObject({
      salutation: 'Frau', name: 'Erika Musterfrau', phone: '0351 1234567', email: 'erika.musterfrau@muster.example',
    });
  });

  it('"Unsere Standorte" is never a name, so the AI is asked', () => {
    const page = MENU_PAGE.replace('Frau Erika Musterfrau\n', '');
    const parsed = parseContact(page);
    expect(parsed.contact.name).toBe('');
    expect(needsName(parsed)).toBe(true);
    // Even directly next to the e-mail it is a menu word, not a person.
    expect(parseContact('Kontakt\nUnsere Standorte\nE-Mail: info@muster.example').contact.name).toBe('');
  });

  it('a bare name counts only next to the e-mail or phone, never elsewhere in the block', () => {
    expect(parseContact('Kontakt\nErika Musterfrau\nE-Mail: jobs@muster.example').contact.name).toBe('Erika Musterfrau');
    expect(parseContact('Kontakt\nErika Musterfrau\nMuster Software GmbH\nMusterweg 5\n01099 Dresden\nE-Mail: jobs@muster.example').contact.name).toBe('');
  });
});

describe('long input stays fast (no polynomial regex)', () => {
  it('a 60 000-character token without "@" and a 60 000-character mixed page parse in well under 100 ms', () => {
    const token = 'a'.repeat(60_000);
    const words = ['Webentwickler', 'Dresden', '01099', 'Tel', '0351', 'info.muster', 'GmbH', 'Kontakt', 'Frau', '3.500', '-', '/'];
    const mixed = Array.from({ length: 9000 }, (_, i) => words[i % words.length] + (i % 13 === 0 ? '\n' : ' ')).join('').slice(0, 60_000);
    for (const text of [token, `${token}@`, mixed, '0'.repeat(60_000), `Kontakt\n${'.'.repeat(60_000)}`]) {
      const t0 = performance.now();
      parseContact(text);
      expect(performance.now() - t0).toBeLessThan(100);
    }
  });
});
