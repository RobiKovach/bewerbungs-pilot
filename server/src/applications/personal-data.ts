import type { ApplicationPackage, PersonalData, PersonalFinding, PersonalKind, Profile, TextPlace } from '@bp/shared';

// Finds personal data in text going to an employer that the person never put in the profile (spec 0.8.3, section 3).
// Pure: no I/O and no logging — found values must never reach the log.

/** Normalized values that are fine to appear in the text. */
export interface AllowedData { emails: string[]; phones: string[]; postalCodes: string[]; birthDates: string[]; links: string[] }

export interface PlacedText { text: string; where: TextPlace }

interface Span { start: number; end: number }
interface Hit extends Span { kind: PersonalKind; value: string; key: string }

// EMAIL and the bare-domain LINK start only where a token starts (look-behind), so a long run of letters, digits or
// dots is scanned once, not once per position — otherwise a long pasted text takes seconds (CodeQL polynomial regex).
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/gi;
/** Not after "+": "+43123456789" is an international phone even when its digits pass the checksum. */
const TAX_ID = /(?<![\d+])[1-9]\d(?:\s?\d{3}){3}(?!\d)/g;
const SOCIAL = /\b\d{2}\s?\d{6}\s?[A-Z]\s?\d{3}\b/gi;
const REFERENCE = /\b\d{5}-\d{10}-S\b/g;
const MONTHS: Record<string, number> = {
  januar: 1, jänner: 1, january: 1, februar: 2, february: 2, märz: 3, maerz: 3, march: 3, april: 4, mai: 5, may: 5,
  juni: 6, june: 6, juli: 7, july: 7, august: 8, september: 9, oktober: 10, october: 10, november: 11, dezember: 12, december: 12,
};
const MONTH = Object.keys(MONTHS).join('|');
/** "01.02.1990", "1.2.90", "01/02/1990", "1990-02-01", "1. Februar 1990", "February 1, 1990". */
const DATE = new RegExp(
  '(?<!\\d)(?:\\d{1,2}\\.\\d{1,2}\\.(?:\\d{4}|\\d{2})|\\d{1,2}/\\d{1,2}/\\d{4}|\\d{4}-\\d{2}-\\d{2})(?!\\d)'
  + `|(?<!\\d)\\d{1,2}\\.?\\s?(?:${MONTH})\\s\\d{4}(?!\\d)|(?<!\\p{L})(?:${MONTH})\\s\\d{1,2},?\\s\\d{4}(?!\\d)`,
  'giu',
);
const BIRTH_WORD = /(?<!\p{L})(?:geboren|geb\.|geburtsdatum|born|date of birth)/giu;
const POSTAL = /\b\d{5}\s+\p{Lu}\p{L}+/gu;
/** Spaces inside a number, but never a line break: two numbers on two lines are two numbers. */
const PHONE = /\+?\(?\d[\d \t\u00a0\u202f/()-]{5,}\d/g;
const LINK = /https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+|(?<![a-z0-9-]|[a-z0-9-]\.)\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:de|com|net|org|io|eu|dev|app)\b(?:\/[^\s<>"')]*)?/gi;
const YEAR_RANGE = /^(?:19|20)\d{2}\s*[-/]\s*(?:19|20)\d{2}$/;
const MONEY_AFTER = /^\s{0,3}(?:€|EUR|Euro)/;
/** "€ 55000", "EUR brutto 55000", "Euro ca. 55000". */
const MONEY_BEFORE = /(?:€|EUR|Euro)\s{0,3}(?:(?:brutto|netto|ca\.|etwa|rund)\s{1,3})?$/i;
const moneyBefore = (text: string, start: number): boolean => MONEY_BEFORE.test(text.slice(Math.max(0, start - 20), start));
/** "12000 Kunden" / "12000 Customers" is a count, not a postal address. */
const COUNT_WORDS = new Set([
  'mitarbeiter', 'mitarbeitende', 'kunden', 'jahre', 'stunden', 'nutzer', 'euro', 'besucher', 'projekte', 'menschen',
  'customers', 'clients', 'employees', 'users', 'years', 'hours', 'visitors', 'projects', 'people', 'members', 'downloads',
]);

export const normEmail = (s: string): string => s.trim().toLowerCase();
export function normPhone(s: string): string {
  // "+49 (0)351 …": the "(0)" is only the local trunk prefix.
  const d = s.replace(/\(0\)/g, '').replace(/\D/g, '');
  if (d.startsWith('0049')) return `0${d.slice(4)}`;
  if (d.startsWith('49')) return `0${d.slice(2)}`;
  return d;
}
export const normLink = (s: string): string =>
  trimEndChars(s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, ''), '/');
/** Drops trailing characters that are in `chars` — a loop, because `/[…]+$/` is quadratic on long runs. */
function trimEndChars(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1])) end--;
  return s.slice(0, end);
}
const TRAILING_PUNCT = '.,;:!?';
/** Any form DATE matches (day first; a two-digit year is in the past century when it is later than this year) → `YYYY-MM-DD`; anything else → ''. */
export function normDate(s: string, now = new Date()): string {
  const t = s.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ymd = (y: string, m: number | string, d: string): string => {
    const yy = Number(y), thisYear = now.getFullYear() % 100;
    const year = y.length === 2 ? (yy > thisYear ? 1900 : 2000) + yy : yy;
    return `${year}-${String(m).padStart(2, '0')}-${d.padStart(2, '0')}`;
  };
  const num = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})$/.exec(t);
  if (num) return ymd(num[3], num[2], num[1]);
  const dayFirst = /^(\d{1,2})\.?\s?(\p{L}+)\s(\d{4})$/u.exec(t);
  if (dayFirst && MONTHS[dayFirst[2].toLowerCase()]) return ymd(dayFirst[3], MONTHS[dayFirst[2].toLowerCase()], dayFirst[1]);
  const monthFirst = /^(\p{L}+)\s(\d{1,2}),?\s(\d{4})$/u.exec(t);
  if (monthFirst && MONTHS[monthFirst[1].toLowerCase()]) return ymd(monthFirst[3], MONTHS[monthFirst[1].toLowerCase()], monthFirst[2]);
  return '';
}

function matches(re: RegExp, text: string): (Span & { value: string })[] {
  return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length, value: m[0] }));
}
const overlaps = (a: Span, spans: Span[]): boolean => spans.some((b) => a.start < b.end && b.start < a.end);

function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase();
  const moved = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ch of moved) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}

/** ISO 7064 MOD 11,10 check digit of the German Steuer-ID. */
function taxIdValid(raw: string): boolean {
  const d = raw.replace(/\s/g, '');
  let product = 10;
  for (let i = 0; i < 10; i++) {
    let sum = (Number(d[i]) + product) % 10;
    if (sum === 0) sum = 10;
    product = (2 * sum) % 11;
  }
  const check = 11 - product === 10 ? 0 : 11 - product;
  return check === Number(d[10]);
}

/** Phone-like numbers (≥ 7 digits) that are not a date, an amount, a year range or part of another match. */
function phoneCandidates(text: string, blocked: Span[]): (Span & { value: string })[] {
  return matches(PHONE, text).filter((m) => {
    if (m.value.replace(/\D/g, '').length < 7) return false;
    if (overlaps(m, blocked)) return false;
    if (YEAR_RANGE.test(m.value)) return false;
    if (MONEY_AFTER.test(text.slice(m.end, m.end + 7)) || moneyBefore(text, m.start)) return false;
    return true;
  });
}

function scan(text: string, allowed: AllowedData): Hit[] {
  const hits: Hit[] = [];
  const add = (kind: PersonalKind, m: Span & { value: string }, key: string) => hits.push({ ...m, kind, value: m.value.trim(), key });

  const emails = matches(EMAIL, text);
  for (const m of emails) if (!allowed.emails.includes(normEmail(m.value))) add('email', m, normEmail(m.value));

  const ibanShaped = matches(IBAN, text);
  const ibans = ibanShaped.filter((m) => ibanValid(m.value));
  for (const m of ibans) add('iban', m, m.value.replace(/\s/g, '').toUpperCase());
  const taxIds = matches(TAX_ID, text).filter((m) => !overlaps(m, ibans) && taxIdValid(m.value));
  for (const m of taxIds) add('taxId', m, m.value.replace(/\s/g, ''));
  const socials = matches(SOCIAL, text).filter((m) => !overlaps(m, ibans));
  for (const m of socials) add('socialSecurity', m, m.value.replace(/\s/g, '').toUpperCase());

  const dates = matches(DATE, text);
  for (const word of matches(BIRTH_WORD, text)) {
    const window: Span = { start: word.end, end: word.end + 30 };
    for (const d of dates) {
      if (d.start < window.start || d.start > window.end) continue;
      const iso = normDate(d.value);
      if (!allowed.birthDates.includes(iso)) add('birthDate', d, iso);
    }
  }

  const postals = matches(POSTAL, text).filter((m) => {
    const digitsEnd = m.start + 5;
    // An amount never starts with 0, so "Euro 01067 Dresden" is still an address.
    const amount = m.value[0] !== '0' && (MONEY_AFTER.test(text.slice(digitsEnd, digitsEnd + 7)) || moneyBefore(text, m.start));
    if (amount) return false;
    return !COUNT_WORDS.has(m.value.slice(5).trim().toLowerCase());
  });
  for (const m of postals) if (!allowed.postalCodes.includes(m.value.slice(0, 5))) add('postalCode', m, m.value.slice(0, 5));

  // IBAN-shaped text with a wrong checksum is not flagged, and its digits are not a phone either.
  const blocked = [...ibanShaped, ...taxIds, ...socials, ...dates, ...matches(REFERENCE, text), ...emails];
  for (const m of phoneCandidates(text, blocked)) {
    const n = normPhone(m.value);
    if (!allowed.phones.includes(n)) add('phone', m, n);
  }

  for (const m of matches(LINK, text)) {
    const value = trimEndChars(m.value, TRAILING_PUNCT);
    const link = { ...m, end: m.start + value.length, value };
    if (overlaps(link, emails) || text[link.start - 1] === '@') continue;
    const n = normLink(value);
    if (!allowed.links.includes(n)) add('link', link, n);
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** Every finding in every text; the same kind + normalized value in the same place counts once. */
export function findPersonalData(texts: PlacedText[], allowed: AllowedData): PersonalFinding[] {
  const seen = new Set<string>();
  const out: PersonalFinding[] = [];
  for (const { text, where } of texts) {
    for (const h of scan(text, allowed)) {
      const id = `${h.kind}|${h.key}|${JSON.stringify(where)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ kind: h.kind, value: h.value, where });
    }
  }
  return out;
}

/** Everything in the package that goes to the employer: letter parts and the CV texts the AI wrote. */
export function packageTexts(p: ApplicationPackage): PlacedText[] {
  const { letter, cv } = p;
  return [
    ...letter.recipient.map((text, i) => ({ text, where: { part: 'letter', field: 'recipient', index: i + 1 } as const })),
    { text: letter.subject, where: { part: 'letter', field: 'subject' } },
    { text: letter.salutation, where: { part: 'letter', field: 'salutation' } },
    ...letter.paragraphs.map((text, i) => ({ text, where: { part: 'letter', field: 'paragraph', index: i + 1 } as const })),
    { text: letter.closing, where: { part: 'letter', field: 'closing' } },
    { text: letter.signature, where: { part: 'letter', field: 'signature' } },
    { text: cv.profil, where: { part: 'cv', field: 'profil' } },
    { text: cv.headline, where: { part: 'cv', field: 'headline' } },
    ...Object.values(cv.descriptions).map((text) => ({ text, where: { part: 'cv', field: 'description' } as const })),
    ...Object.values(cv.translations).map((text) => ({ text, where: { part: 'cv', field: 'translation' } as const })),
    ...cv.skillGroups.map((g) => ({ text: g.name, where: { part: 'cv', field: 'skillGroup' } as const })),
  ];
}

/**
 * What may appear: the person's own data and own free profile texts (live profile and the package snapshot), the vacancy's contact (email,
 * phone, postal code) and its links,
 * and the company's phones and postal codes (vacancy text, recipient lines). Emails and links from the free vacancy
 * text are NOT allowed — that is how a poisoned offer would look.
 */
export function allowedFor(p: ApplicationPackage, profile: Profile, vacancyText: string | null): AllowedData {
  const people: PersonalData[] = [profile.sections.personal.data, p.snapshot.personal];
  const companyText = [vacancyText ?? '', ...p.letter.recipient].join('\n');
  const ownText = ownProfileText(p, profile);
  const fiveDigits = (text: string) => matches(/(?<!\d)\d{5}(?!\d)/g, text).map((m) => m.value);
  const nonEmpty = (xs: string[]) => [...new Set(xs.filter((x) => x !== ''))];
  return {
    emails: nonEmpty([
      ...people.map((x) => normEmail(x.email)), normEmail(p.vacancy.contact?.email ?? ''),
      ...matches(EMAIL, ownText).map((m) => normEmail(m.value)),
    ]),
    phones: nonEmpty([
      ...people.map((x) => normPhone(x.phone)), normPhone(p.vacancy.contact?.phone ?? ''),
      ...matches(PHONE, `${companyText}\n${ownText}`).map((m) => normPhone(m.value)),
    ]),
    postalCodes: nonEmpty([...people.map((x) => x.postalCode.trim()), p.vacancy.contact?.postcode.trim() ?? '', ...fiveDigits(companyText), ...fiveDigits(ownText)]),
    birthDates: nonEmpty(people.map((x) => normDate(x.birthDate))),
    links: nonEmpty([
      ...people.flatMap((x) => x.links.map((l) => normLink(l.url))), normLink(p.vacancy.url), normLink(p.vacancy.partnerUrl ?? ''), ...TECH_NAMES,
      ...matches(LINK, ownText).map((m) => normLink(trimEndChars(m.value, TRAILING_PUNCT))),
    ]),
  };
}

/** Technology names the bare-domain rule would take for links. */
const TECH_NAMES = ['asp.net', 'vb.net', 'ado.net', 'socket.io'];

/** The person's own free texts (live profile and the package snapshot): what they wrote there is theirs, not foreign. */
function ownProfileText(p: ApplicationPackage, profile: Profile): string {
  const s = profile.sections;
  const entries = [...s.education.data.items, ...s.experience.data.items, ...p.snapshot.education, ...p.snapshot.experience];
  return [
    ...entries.flatMap((e) => Object.values(e).filter((v): v is string => typeof v === 'string')),
    ...[...s.skills.data.items, ...p.snapshot.skills].map((x) => x.name),
    ...[...s.languages.data.items, ...p.snapshot.languages].map((x) => x.certificate),
    ...profile.stories.flatMap((x) => [x.title, x.text]),
  ].join('\n');
}
