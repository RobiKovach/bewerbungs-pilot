import type { ContactField, VacancyContact } from '@bp/shared';
import { emptyContact, parseContact } from '../vacancies/contact-parse.js';
import type { PageLink } from '../vacancies/sources/page-reader.js';
import { VACANCY_LIMITS } from '../vacancies/schema.js';
import { isApplyService, isBoard, siteOf, type PageKind } from './links.js';

/**
 * The employer contact from the pages one research read (spec 3.2, 4.2 step 5), and how it joins the card's contact.
 * Only what literally stands on the pages is taken (the deterministic parser plus `mailto:`/`tel:` links); nothing
 * here asks the AI. A filled field of the card is never changed: a different value only comes back as `differing`.
 */

export interface FoundPage { url: string; kind: PageKind; text: string; links: PageLink[] }

const FIELDS: ContactField[] = ['email', 'salutation', 'name', 'phone', 'street', 'postcode', 'city'];
const L = VACANCY_LIMITS;
/** Candidates looked at per page: a team or footer list of dozens of addresses never decides by its length. */
const PER_PAGE = 5;

/** The vacancy and apply pages say whom to write to; the Impressum has the legal (general) address. */
const CONTACT_ORDER: Record<PageKind, number> = { vacancy: 0, apply: 0, contact: 1, impressum: 2, careers: 3, about: 3, home: 3, news: 4 };
/** The address comes from the legal notice first: a vacancy page's address is often the work place, not the office. */
const ADDRESS_ORDER: Record<PageKind, number> = { impressum: 0, contact: 1, vacancy: 2, apply: 2, careers: 3, about: 3, home: 3, news: 4 };

const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_ONLY = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const NEVER_LOCAL = /^(?:privacy|datenschutz|no-?reply|do-?not-?reply|donotreply|webmaster)$/i;
const RECRUITING_LOCAL = /bewerbung|jobs?|karriere|career|^hr$|^hr[._-]|personal/i;
const GENERAL_LOCAL = /^(?:info|kontakt|contact|office|mail|hallo|hello)$/i;

const clip = (s: string, max: number) => s.trim().slice(0, max);
const digits = (s: string) => s.replace(/\D/g, '');

/** `name@domain` with the domain lower-cased; '' for anything that is not one address. */
function normEmail(raw: string): string {
  const v = raw.trim().replace(/\.+$/, '');
  if (!EMAIL_ONLY.test(v)) return '';
  const at = v.lastIndexOf('@');
  return `${v.slice(0, at)}@${v.slice(at + 1).toLowerCase()}`;
}

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** The address of a `mailto:` link (the first one; `?subject=…` dropped). */
function mailtoAddress(href: string): string {
  const rest = href.replace(/^mailto:/i, '').split('?')[0] ?? '';
  return normEmail(decode(rest).split(',')[0] ?? '');
}

/** The number of a `tel:` link as written, if it has a plausible number of digits. */
function telNumber(href: string): string {
  const v = decode(href.replace(/^tel:/i, '')).trim();
  const n = digits(v).length;
  return n >= 7 && n <= 15 ? v : '';
}

/**
 * An address the employer would read: not a privacy/no-reply/webmaster box, and not the box of a job board or an
 * application service (their support or data-protection address is never the employer's) — unless that very host
 * is the company site being researched.
 */
function usable(email: string, site: string): boolean {
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (NEVER_LOCAL.test(local) || /(?:^|\.)arbeitsagentur\.de$/.test(domain)) return false;
  if ((isBoard(domain) || isApplyService(domain)) && siteOf(`https://${domain}`) !== site) return false;
  return true;
}

/** Up to PER_PAGE usable addresses of one page: `mailto:` links first, then the text. */
function pageEmails(p: FoundPage, site: string): string[] {
  const out: string[] = [];
  const add = (e: string) => { if (e && !out.includes(e) && usable(e, site)) out.push(e); };
  for (const l of p.links) if (/^mailto:/i.test(l.href)) add(mailtoAddress(l.href));
  for (const m of p.text.matchAll(EMAIL)) add(normEmail(m[0]));
  return out.slice(0, PER_PAGE);
}

/** Recruiting boxes before personal or other ones, general boxes (info@, kontakt@) last. */
function emailRank(email: string): number {
  const local = email.slice(0, email.lastIndexOf('@'));
  if (RECRUITING_LOCAL.test(local)) return 0;
  return GENERAL_LOCAL.test(local) ? 2 : 1;
}

/** Up to PER_PAGE numbers of one page: `tel:` links (not on a board's own pages), then the labelled number of the text. */
function pagePhones(p: FoundPage, site: string): string[] {
  const out: string[] = [];
  const onBoard = isBoard(hostOf(p.url)) && siteOf(p.url) !== site;
  if (!onBoard) for (const l of p.links) if (/^tel:/i.test(l.href)) { const n = telNumber(l.href); if (n && !out.some((x) => digits(x) === digits(n))) out.push(n); }
  const fromText = parseContact(p.text).contact.phone;
  if (fromText && !out.some((x) => digits(x) === digits(fromText))) out.push(fromText);
  return out.slice(0, PER_PAGE);
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

const byOrder = (order: Record<PageKind, number>, pages: FoundPage[]) =>
  pages.map((p, i) => ({ p, i })).sort((a, b) => order[a.p.kind] - order[b.p.kind] || a.i - b.i).map((x) => x.p);

/**
 * The contact found on `pages` (`site`: the company site key, `siteOf`). E-mail and phone come from the most
 * relevant page that has one (vacancy/apply → contact → Impressum → others); on that page a recruiting box wins over
 * info@. The name too; the address from the Impressum first.
 */
export function contactFromPages(pages: FoundPage[], site: string): VacancyContact {
  const c = emptyContact();
  for (const p of byOrder(CONTACT_ORDER, pages)) {
    if (!c.email) {
      const emails = pageEmails(p, site);
      if (emails.length) c.email = [...emails].sort((a, b) => emailRank(a) - emailRank(b))[0];
    }
    if (!c.phone) c.phone = pagePhones(p, site)[0] ?? '';
    if (!c.name) {
      const parsed = parseContact(p.text).contact;
      if (parsed.name) { c.name = parsed.name; c.salutation = parsed.salutation; }
    }
  }
  for (const p of byOrder(ADDRESS_ORDER, pages)) {
    const a = parseContact(p.text).contact;
    if (a.street || a.postcode) { c.street = a.street; c.postcode = a.postcode; c.city = a.city; break; }
  }
  return {
    email: clip(c.email, L.email), salutation: c.salutation, name: clip(c.name, L.name), phone: clip(c.phone, L.phone),
    street: clip(c.street, L.street), postcode: clip(c.postcode, L.postcode), city: clip(c.city, L.city),
  };
}

/** Two values that say the same (case, spaces, phone punctuation) are not "different". */
function same(field: ContactField, a: string, b: string): boolean {
  if (field === 'phone') return digits(a.replace(/^\+49|^0049/, '0')) === digits(b.replace(/^\+49|^0049/, '0'));
  return a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Joins a found contact into the card's: only empty fields are filled (and marked as found automatically); a filled
 * field is never changed — a different found value is returned in `differing` for the person to take or leave.
 * The salutation is filled only together with a name that was filled here. All fields empty → `contact: null`.
 */
export function mergeContact(current: VacancyContact | null, found: VacancyContact, auto: ContactField[] | undefined): {
  contact: VacancyContact | null; auto: ContactField[]; differing: Partial<VacancyContact>;
} {
  const next: VacancyContact = { ...(current ?? emptyContact()) };
  const marked = new Set<ContactField>(auto ?? []);
  const differing: Partial<VacancyContact> = {};
  for (const f of FIELDS) {
    if (f === 'salutation') continue;
    const v = found[f];
    if (!v) continue;
    if (next[f] === '') {
      next[f] = v;
      marked.add(f);
      if (f === 'name' && found.salutation) { next.salutation = found.salutation; marked.add('salutation'); }
    } else if (!same(f, next[f], v)) {
      (differing as Record<string, string>)[f] = v;
      if (f === 'name' && found.salutation) differing.salutation = found.salutation;
    }
  }
  const kept = FIELDS.filter((f) => marked.has(f) && next[f] !== '');
  const anything = FIELDS.some((f) => f !== 'salutation' && next[f] !== '');
  return { contact: anything ? next : null, auto: kept, differing };
}
