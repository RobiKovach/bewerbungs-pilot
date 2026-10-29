import type { Salutation, VacancyContact } from '@bp/shared';
import { VACANCY_LIMITS } from './schema.js';

/**
 * Reads an employer contact from the text of a page (the Arbeitsagentur offer after the captcha, or a partner page)
 * without any AI. Only what literally stands in the text is taken; anything uncertain stays '' (unknown).
 *
 * The AA page shows the contact as a block (B1 live checks):
 *   Informationen zur Bewerbung / Kontaktadresse / <company> / <Vorname Nachname> / E-Mail: … / Bewerben Sie sich: …
 * Other pages get a short block after a heading like "Ansprechpartner" or "Kontakt". Without any block only e-mail
 * and phone are read from the whole text, and an address only as a complete street + postcode + city.
 */

export interface ParsedContact { contact: VacancyContact; found: Array<keyof VacancyContact> }

const L = VACANCY_LIMITS;
const FIELDS: Array<keyof VacancyContact> = ['email', 'salutation', 'name', 'phone', 'street', 'postcode', 'city'];
/** Characters of a partner page taken after a contact heading. */
const BLOCK_CHARS = 600;
/** Characters around the contact the AI sees when it is asked for the name. */
export const NAME_WINDOW_CHARS = 2000;

const AA_START = /^Kontaktadresse\s*:?\s*$/im;
const AA_END = /^(Bewerben Sie sich|Fußbereich|Referenz-Nr\.)/im;
/** A heading line, optionally followed by the contact on the same line ("Ansprechpartnerin: Frau …"). */
const HEADING = /^(?:Ihr(?:e)?\s+)?(?:Ansprechpartner(?:in)?(?:\/in)?|Ansprechperson|Kontaktperson|Kontakt(?:adresse)?|Contact(?: person)?)\b\s*(?::|$)/im;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SKIP_EMAIL = /^(?:no-?reply|do-?not-?reply|donotreply)@|@(?:[\w-]+\.)*arbeitsagentur\.de$/i;

const PHONE = /(?:\+49|0049)\s*(?:\(0\)\s*)?\d[\d\s/()-]{4,}\d|\(?0\d[\d\s/()-]{4,}\d/g;
const PHONE_LABEL = /\b(?:Tel(?:efon)?|Phone|Fon|Mobil(?:funk)?|Handy|Rufnummer)\b\.?\s*(?:\(?[A-Za-z.]*\)?)?\s*:?\s*$|\bT\s*[.:]\s*$/i;
const NOT_PHONE_CONTEXT = /\b(?:Nr|Nummer|Stellennummer|Referenz|Kennziffer|ID|Code|Fax)\b/i;

/** Same-line spaces only: a name never continues onto the next line ("Personalabteilung"). */
const SALUTATION_NAME = /\b(Frau|Herrn?)[ \t]+((?:(?:Dr|Prof)\.[ \t]*)*[\p{Lu}][\p{L}'’-]+(?:[ \t]+[\p{Lu}][\p{L}'’-]+){0,2})/u;
const NAME_LINE = /^[\p{Lu}][\p{Ll}'’-]+(?:-[\p{Lu}][\p{Ll}'’-]+)?(?:\s+(?:von|van|de|zu|der|den)\b)?(?:\s+[\p{Lu}][\p{Ll}'’-]+(?:-[\p{Lu}][\p{Ll}'’-]+)?){1,2}$/u;
const COMPANY_WORD = /\b(?:GmbH|AG|KG|SE|UG|e\.\s?V\.|mbH|Gruppe|Group|Holding|Consulting|Personal|Service|Services|Team|Solutions|Systems|Technologies|Akademie|Universität|Stadt|Landkreis|Agentur|Bewerbung|Karriere|Jobs?)\b/i;
const NON_NAME_WORDS = /\b(?:Kontakt|Ansprechpartner(?:in)?|Telefon|E-Mail|Bewerben|Stellenangebot|Informationen|Homepage|Webseite|Personalabteilung|Recruiting|Human Resources)\b/i;

const STREET = /^((?:[\p{L}][\p{L}ß.'’-]*\s)*[\p{L}ß.'’-]*(?:straße|strasse|str\.|weg|allee|platz|ring|gasse|damm|ufer|chaussee|promenade|steig|pfad|markt|hof)\s*\d{1,4}\s*[a-zA-Z]?(?:\s*[-–]\s*\d{1,4}\s*[a-zA-Z]?)?)$/iu;
const POSTCODE_CITY = /^(\d{5})\s+([\p{Lu}][\p{L}.'’-]*(?:[\s-]+(?:[\p{Lu}][\p{L}.'’-]*|an der|am|im|bei|ob der|\(\p{L}+\)))*)$/u;

const clip = (s: string, max: number) => s.trim().slice(0, max);

/** The contact block of the page: the AA "Kontaktadresse" block, or a short part after a contact heading. */
function findBlock(text: string): { block: string; start: number; aa: boolean } | null {
  const aa = AA_START.exec(text);
  if (aa) {
    const start = aa.index + aa[0].length;
    const rest = text.slice(start);
    const end = AA_END.exec(rest);
    return { block: rest.slice(0, end ? end.index : BLOCK_CHARS), start, aa: true };
  }
  const h = HEADING.exec(text);
  if (h) {
    const start = h.index + h[0].length;
    return { block: text.slice(start, start + BLOCK_CHARS), start, aa: false };
  }
  return null;
}

function firstEmail(text: string): string {
  for (const m of text.matchAll(EMAIL)) {
    const email = m[0].replace(/\.+$/, '');
    if (!SKIP_EMAIL.test(email)) return email;
  }
  return '';
}

/** Only phone numbers with a label before them on the same line ("Tel.: …") or an international +49 prefix. */
function firstPhone(text: string): string {
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(PHONE)) {
      const raw = m[0].trim().replace(/[\s/(-]+$/, '');
      const digits = raw.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) continue;
      const i = m.index ?? 0;
      const before = line.slice(0, i);
      if (PHONE_LABEL.test(before)) return raw;
      // Unlabelled: only +49 / 0049, not after "Nr."/"Referenz"/"Fax", not glued to letters or digits.
      const international = /^(?:\+49|0049)/.test(raw);
      const glued = /[\p{L}\d-]/u.test(line[i - 1] ?? ' ');
      if (international && !glued && !NOT_PHONE_CONTEXT.test(before)) return raw;
    }
  }
  return '';
}

function nameWithSalutation(text: string): { salutation: Salutation; name: string } | null {
  const m = SALUTATION_NAME.exec(text);
  if (!m) return null;
  const name = m[2].replace(/\s+/g, ' ').trim();
  // "Herr Dr." alone, or one word only ("Frau Müller") — the surname alone is still a usable name.
  if (!/[\p{L}]{2,}/u.test(name.replace(/(?:Dr|Prof)\./g, ''))) return null;
  return { salutation: m[1] === 'Frau' ? 'Frau' : 'Herr', name };
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/** A line that reads as a person's name ("Erika Musterfrau"), not a company, a heading or an address. */
function isNameLine(line: string): boolean {
  return NAME_LINE.test(line) && !COMPANY_WORD.test(line) && !NON_NAME_WORDS.test(line) && !STREET.test(line);
}

/** Address parts; `alone` allows a postcode + city without a street (inside a contact block). */
function address(text: string, alone: boolean): { street: string; postcode: string; city: string } {
  const parts = lines(text).flatMap((l) => l.split(/\s*,\s*/));
  for (let i = 0; i < parts.length; i++) {
    const street = STREET.exec(parts[i]);
    const pc = POSTCODE_CITY.exec(parts[i + 1] ?? '');
    if (street && pc) return { street: street[1], postcode: pc[1], city: pc[2] };
  }
  if (alone) {
    for (const p of parts) {
      const pc = POSTCODE_CITY.exec(p);
      if (pc) return { street: '', postcode: pc[1], city: pc[2] };
    }
  }
  return { street: '', postcode: '', city: '' };
}

export function emptyContact(): VacancyContact {
  return { email: '', salutation: '', name: '', phone: '', street: '', postcode: '', city: '' };
}

export function parseContact(text: string): ParsedContact {
  const t = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  const found = findBlock(t);
  const block = found?.block ?? '';

  const email = (block && firstEmail(block)) || firstEmail(t);
  const phone = (block && firstPhone(block)) || firstPhone(t);

  let salutation: Salutation = '';
  let name = '';
  const withSal = (block && nameWithSalutation(block)) || (!found ? nameWithSalutation(t) : null);
  if (withSal) ({ salutation, name } = withSal);
  else if (found) {
    // AA layout: the first line after "Kontaktadresse" is the company, a person's name may follow.
    const candidates = lines(block).slice(found.aa ? 1 : 0).filter((l) => !/@|\d/.test(l));
    name = candidates.find(isNameLine) ?? '';
  }

  const addr = found ? address(block, true) : address(t, false);

  const contact: VacancyContact = {
    email: clip(email, L.email), salutation, name: clip(name, L.name), phone: clip(phone, L.phone),
    street: clip(addr.street, L.street), postcode: clip(addr.postcode, L.postcode), city: clip(addr.city, L.city),
  };
  return { contact, found: FIELDS.filter((f) => contact[f] !== '') };
}

/** The AI is asked for the name only when an e-mail or phone was found but no name. */
export function needsName(parsed: ParsedContact): boolean {
  const c = parsed.contact;
  return (c.email !== '' || c.phone !== '') && c.name === '';
}

/** ≤ NAME_WINDOW_CHARS around the contact: the block if there is one, else around the e-mail or phone found. */
export function nameWindow(text: string, contact: VacancyContact): string {
  const t = text.replace(/\r\n?/g, '\n');
  const found = findBlock(t);
  let at = found ? found.start : -1;
  if (at < 0) {
    for (const part of [contact.email, contact.phone]) {
      if (part && t.includes(part)) { at = t.indexOf(part); break; }
    }
  }
  if (at < 0) at = 0;
  const from = Math.max(0, at - NAME_WINDOW_CHARS / 2);
  return t.slice(from, from + NAME_WINDOW_CHARS);
}
