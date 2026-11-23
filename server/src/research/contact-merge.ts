import type { ContactField, VacancyContact } from '@bp/shared';
import { emptyContact, parseContact, parseContactBlock } from '../vacancies/contact-parse.js';
import type { PageLink } from '../vacancies/sources/page-reader.js';
import { VACANCY_LIMITS } from '../vacancies/schema.js';
import { isApplyService, isBoard, siteOf, type PageKind } from './links.js';

/**
 * The employer contact from the pages one research read (spec 3.2, 4.2 step 5), and how it joins the card's contact.
 * Only what literally stands on the pages is taken (the deterministic parser plus `mailto:`/`tel:` links); nothing
 * here asks the AI. A filled field of the card is never changed: a different value only comes back as `differing`.
 */

/**
 * `listing`: the pasted page turned out not to be the company's own (an unknown board, final review I1) — treated like a
 * known board's page: only the ad's contact block, never its footer, phone links, own-domain e-mails or address.
 */
export interface FoundPage { url: string; kind: PageKind; text: string; links: PageLink[]; listing?: boolean }

const FIELDS: ContactField[] = ['email', 'salutation', 'name', 'phone', 'street', 'postcode', 'city'];
const ADDRESS: Array<'street' | 'postcode' | 'city'> = ['street', 'postcode', 'city'];
const L = VACANCY_LIMITS;
/** Candidates looked at per page: a team or footer list of dozens of addresses never decides by its length. */
const PER_PAGE = 5;

/** The vacancy and apply pages say whom to write to; the Impressum has the legal (general) address. */
const CONTACT_ORDER: Record<PageKind, number> = { vacancy: 0, apply: 0, contact: 1, impressum: 2, careers: 3, about: 3, home: 3, news: 4 };
/**
 * The address comes from the legal notice first (Ruling R9): a vacancy page's address is often the work place, not
 * the office. Never from a job board's own pages.
 */
const ADDRESS_ORDER: Record<PageKind, number> = { impressum: 0, contact: 1, vacancy: 2, apply: 2, careers: 3, about: 3, home: 3, news: 4 };

const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_ONLY = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
/**
 * Privacy, data-protection and no-reply boxes are never the employer's contact, also as part of a longer name
 * (datenschutzbeauftragter@, datenschutz.firma@, noreply-jobs@); dsb@, dpo@ and webmaster@ only as the whole name.
 */
const NEVER_LOCAL = /datenschutz|privacy|data-?protection|no-?reply|do-?not-?reply|^(?:dsb|dpo|webmaster)$/i;
const RECRUITING_LOCAL = /bewerbung|jobs?|karriere|career|^hr$|^hr[._-]|personal/i;
const GENERAL_LOCAL = /^(?:info|kontakt|contact|office|mail|hallo|hello)$/i;

/** Pages that may name the person to write to (Ruling R10): an Impressum names the managing director, not the recruiter. */
const NAME_KINDS = new Set<PageKind>(['vacancy', 'apply', 'contact']);

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
export function mailtoAddress(href: string): string {
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
  // An unknown board's own boxes (info@<board>) are not the employer's — like a known board's (final review I1).
  const listingSite = p.listing === true && siteOf(p.url) !== site ? siteOf(p.url) : '';
  const add = (e: string) => {
    if (e && !out.includes(e) && usable(e, site) && !(listingSite && ownDomain(e, listingSite))) out.push(e);
  };
  for (const l of p.links) if (/^mailto:/i.test(l.href)) add(mailtoAddress(l.href));
  for (const m of p.text.matchAll(EMAIL)) add(normEmail(m[0]));
  return out.slice(0, PER_PAGE);
}

/** The company site's own domain or a subdomain of it (`site`: `https://host` without www.). */
function ownDomain(email: string, site: string): boolean {
  const host = site.replace(/^https:\/\//, '');
  const domain = email.slice(email.lastIndexOf('@') + 1).replace(/^www\./, '');
  return host !== '' && (domain === host || domain.endsWith(`.${host}`));
}

/**
 * Within one page: the company's own domain before any other (a footer "Webdesign: info@agentur.de" is not the
 * employer), then recruiting boxes before personal or other ones, general boxes (info@, kontakt@) last.
 */
function emailRank(email: string, site: string): number {
  const local = email.slice(0, email.lastIndexOf('@'));
  const kind = RECRUITING_LOCAL.test(local) ? 0 : GENERAL_LOCAL.test(local) ? 2 : 1;
  return (ownDomain(email, site) ? 0 : 10) + kind;
}

/** A job board's own page (not the company site): its header, footer and hotline are not the employer's. */
const onBoard = (p: FoundPage, site: string) => (p.listing === true || isBoard(hostOf(p.url))) && siteOf(p.url) !== site;

/**
 * What the text of a page says about the contact: on a board's own page only the ad's contact block (Ruling R11),
 * elsewhere the whole page.
 */
const parsedOf = (p: FoundPage, site: string): VacancyContact | null =>
  onBoard(p, site) ? parseContactBlock(p.text) : parseContact(p.text).contact;

/**
 * Up to PER_PAGE numbers of one page: `tel:` links (not on a board's own pages), then the labelled number of the
 * text (on a board page: only from the ad's contact block).
 */
function pagePhones(p: FoundPage, site: string): string[] {
  const out: string[] = [];
  if (!onBoard(p, site)) for (const l of p.links) if (/^tel:/i.test(l.href)) { const n = telNumber(l.href); if (n && !out.some((x) => digits(x) === digits(n))) out.push(n); }
  const fromText = parsedOf(p, site)?.phone ?? '';
  if (fromText && !out.some((x) => digits(x) === digits(fromText))) out.push(fromText);
  return out.slice(0, PER_PAGE);
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

const byOrder = (order: Record<PageKind, number>, pages: FoundPage[]) =>
  pages.map((p, i) => ({ p, i })).sort((a, b) => order[a.p.kind] - order[b.p.kind] || a.i - b.i).map((x) => x.p);

/**
 * The contact found on `pages` (`site`: the company site key, `siteOf`). The e-mail is the company's own domain from
 * the most relevant page that has one, else any usable address from the most relevant page that has one (vacancy/apply
 * → contact → Impressum → others; never e-mails from news pages); within a page a recruiting box wins. The phone comes
 * from the most relevant page that has one. The name only from vacancy/apply/contact pages (R10), on a
 * board page only from the ad's contact block (R11); the address from the Impressum first, never from a board page.
 */
export function contactFromPages(pages: FoundPage[], site: string): VacancyContact {
  const c = emptyContact();
  const ordered = byOrder(CONTACT_ORDER, pages);
  // The company's own domain on any page beats another domain on a more relevant page (Task 12b, Ruling R44):
  // a vacancy on an apply service may name a product or agency box (info@get-vibe.de) while Kontakt has the firm's.
  for (const p of ordered) {
    if (c.email || p.kind === 'news') continue;
    const own = pageEmails(p, site).filter((e) => ownDomain(e, site));
    if (own.length) c.email = [...own].sort((a, b) => emailRank(a, site) - emailRank(b, site))[0];
  }
  for (const p of ordered) {
    if (!c.email && p.kind !== 'news') {
      const emails = pageEmails(p, site);
      if (emails.length) c.email = [...emails].sort((a, b) => emailRank(a, site) - emailRank(b, site))[0];
    }
    if (!c.phone) c.phone = pagePhones(p, site)[0] ?? '';
    if (!c.name && NAME_KINDS.has(p.kind)) {
      const parsed = parsedOf(p, site);
      if (parsed?.name) { c.name = parsed.name; c.salutation = parsed.salutation; }
    }
  }
  for (const p of byOrder(ADDRESS_ORDER, pages)) {
    if (onBoard(p, site)) continue;
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
 * The salutation is filled only together with a name that was filled here, and never replaces one the card has; a
 * found name whose salutation contradicts the card's goes to `differing` instead. All fields empty → `contact: null`.
 */
export function mergeContact(current: VacancyContact | null, found: VacancyContact, auto: ContactField[] | undefined): {
  contact: VacancyContact | null; auto: ContactField[]; differing: Partial<VacancyContact>;
} {
  const next: VacancyContact = { ...(current ?? emptyContact()) };
  const marked = new Set<ContactField>(auto ?? []);
  const differing: Partial<VacancyContact> = {};
  // The address is one thing (final review M1): filled only when the card has none of it, else offered as a whole when
  // it differs — never a found street and postcode next to the person's own city.
  const foundAddress = ADDRESS.some((f) => found[f] !== '');
  if (foundAddress) {
    if (ADDRESS.every((f) => next[f] === '')) {
      for (const f of ADDRESS) if (found[f]) { next[f] = found[f]; marked.add(f); }
    } else if (ADDRESS.some((f) => found[f] !== '' && !same(f, next[f], found[f]))) {
      for (const f of ADDRESS) if (found[f]) differing[f] = found[f];
    }
  }
  for (const f of FIELDS) {
    if (f === 'salutation' || (ADDRESS as ContactField[]).includes(f)) continue;
    const v = found[f];
    if (!v) continue;
    if (f === 'name' && next.name === '' && next.salutation !== '' && found.salutation !== '' && next.salutation !== found.salutation) {
      // The person's "Herr" never sits next to a found "Frau X": offer the found pair instead.
      differing.name = v;
      differing.salutation = found.salutation;
    } else if (next[f] === '') {
      next[f] = v;
      marked.add(f);
      if (f === 'name' && found.salutation && next.salutation === '') { next.salutation = found.salutation; marked.add('salutation'); }
    } else if (!same(f, next[f], v)) {
      (differing as Record<string, string>)[f] = v;
      if (f === 'name' && found.salutation) differing.salutation = found.salutation;
    }
  }
  const kept = FIELDS.filter((f) => marked.has(f) && next[f] !== '');
  const anything = FIELDS.some((f) => f !== 'salutation' && next[f] !== '');
  return { contact: anything ? next : null, auto: kept, differing };
}

/**
 * The "found automatically" marks of a package's contact copy that remain after the person confirmed `confirmed` on the
 * card (final review M2): a field the person kept unchanged (same value) is confirmed; a field they changed is not —
 * the package still holds the found value.
 */
export function remainingMarks(auto: ContactField[] | undefined, copy: VacancyContact | null, confirmed: VacancyContact | null): ContactField[] {
  return (auto ?? []).filter((f) => !(copy && confirmed && copy[f] !== '' && same(f, copy[f], confirmed[f])));
}
