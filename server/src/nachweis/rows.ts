import type { ApplicationPackage, ApplicationStatus, ContactField, NachweisCandidate, Vacancy, VacancyContact } from '@bp/shared';
import { isAaHost } from '../vacancies/aa-links.js';
import { isBoard } from '../research/links.js';

/** Where an application's offer came from — decides the "where I searched" boxes and the standard form's "Quelle". */
export type RowOrigin = 'arbeitsagentur' | 'board' | 'company' | 'none';

/** One line of the Bewerbungsnachweis (spec 0.15.0, section 7). German text, ready to print. */
export interface NachweisRow {
  packageId: string;
  initiative: boolean;
  /** DD.MM.YYYY or ''. */
  foundAt: string;
  position: string;
  /** [company, street, 'postcode city'] — the address only when street, postcode and city are all known. */
  companyLines: string[];
  contact: string;
  appliedAt: string;
  appliedIso: string;
  result: '' | 'Vorstellungsgespräch' | 'Absage' | 'Zusage' | 'zurückgezogen';
  origin: RowOrigin;
  /** A contact field the app found by itself and the person has not confirmed is printed in this row. */
  contactUnconfirmed: boolean;
}

const RESULTS: Partial<Record<ApplicationStatus, NachweisRow['result']>> = {
  interview: 'Vorstellungsgespräch', rejected: 'Absage', offer: 'Zusage', withdrawn: 'zurückgezogen',
};

/** Local date of an ISO timestamp as DD.MM.YYYY ('' for anything unreadable). */
export function germanDate(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

const firstSubmission = (p: ApplicationPackage) => p.history.find((h) => h.kind === 'sent' || h.kind === 'submitted');

/** Has a sent or submitted history entry (also after a later interview, rejection, offer or withdrawal). */
export function isSubmitted(p: ApplicationPackage): boolean {
  return firstSubmission(p) !== undefined;
}

/** When the application last went into a Nachweis file; null = never. */
export function exportedAt(p: ApplicationPackage): string | null {
  return [...p.history].reverse().find((h) => h.kind === 'nachweis')?.at ?? null;
}

const REFNR_IN_URL = /\/jobsuche\/jobdetail\/([^/?#]+)/;

function refnr(p: ApplicationPackage, v: Vacancy | undefined): string {
  if (v?.source === 'arbeitsagentur' && v.sourceId) return v.sourceId;
  const m = REFNR_IN_URL.exec(p.vacancy.url);
  return m && isAaHost(p.vacancy.url) ? decodeURIComponent(m[1]!) : '';
}

function hostOf(url: string): string | null {
  return URL.canParse(url) ? new URL(url).hostname : null;
}

function originOf(p: ApplicationPackage, v: Vacancy | undefined): RowOrigin {
  const url = v?.url || p.vacancy.url;
  if (v?.source === 'arbeitsagentur' || (url && isAaHost(url))) return 'arbeitsagentur';
  if (v?.source === 'company') return 'company';
  const host = url ? hostOf(url) : null;
  if (!host) return 'none';
  // An applicant system (Personio, Greenhouse, …) is the company's own job page: counted as a company website.
  return isBoard(host) ? 'board' : 'company';
}

/** The contact and the address in print, and the fields they used. */
function contactParts(c: VacancyContact | null, company: string): { contact: string; companyLines: string[]; used: ContactField[] } {
  const used: ContactField[] = [];
  const companyLines = [company];
  if (!c) return { contact: '', companyLines, used };
  if (c.street && c.postcode && c.city) {
    companyLines.push(c.street, `${c.postcode} ${c.city}`);
    used.push('street', 'postcode', 'city');
  }
  const who = [c.salutation, c.name].filter(Boolean).join(' ');
  if (c.name) used.push('name');
  if (c.salutation) used.push('salutation');
  let reach = '';
  if (c.phone) { reach = `Tel. ${c.phone}`; used.push('phone'); } else if (c.email) { reach = c.email; used.push('email'); }
  return { contact: [who, reach].filter(Boolean).join(', '), companyLines, used };
}

function rowOf(p: ApplicationPackage, v: Vacancy | undefined): NachweisRow {
  const first = firstSubmission(p)!;
  const initiative = p.vacancy.initiative === true || v?.initiative === true;
  // The card may have been completed after sending (contact found later); the package keeps what it was sent with.
  const contact = v ? v.contact : p.vacancy.contact;
  const auto = v ? v.contactAuto ?? [] : p.vacancy.contactAuto ?? [];
  const parts = contactParts(contact, p.vacancy.company);
  const ref = refnr(p, v);
  return {
    packageId: p.id,
    initiative,
    foundAt: initiative || !v ? '' : germanDate(v.foundAt),
    position: ref ? `${p.vacancy.title} (Ref.-Nr. ${ref})` : p.vacancy.title,
    companyLines: parts.companyLines,
    contact: parts.contact,
    appliedAt: germanDate(first.at),
    appliedIso: first.at,
    result: RESULTS[p.status] ?? '',
    origin: originOf(p, v),
    contactUnconfirmed: parts.used.some((f) => auto.includes(f)),
  };
}

/** The rows of every submitted package, oldest application first. Two sent packages for one vacancy are two rows. */
export function buildRows(packages: ApplicationPackage[], vacancy: (id: string) => Vacancy | undefined): NachweisRow[] {
  return packages.filter(isSubmitted).map((p) => rowOf(p, vacancy(p.vacancyId)))
    .sort((a, b) => a.appliedIso.localeCompare(b.appliedIso));
}

export function toCandidates(packages: ApplicationPackage[], vacancy: (id: string) => Vacancy | undefined): NachweisCandidate[] {
  const byId = new Map(packages.map((p) => [p.id, p]));
  return buildRows(packages, vacancy).map((r) => {
    const p = byId.get(r.packageId)!;
    return { packageId: p.id, company: p.vacancy.company, title: p.vacancy.title, appliedAt: r.appliedIso, exportedAt: exportedAt(p), contactUnconfirmed: r.contactUnconfirmed };
  });
}

/** The "where I searched" boxes for the whole file. */
export function searchedBoxes(rows: NachweisRow[]): { aa: boolean; boards: boolean; companySites: boolean } {
  return {
    aa: rows.some((r) => r.origin === 'arbeitsagentur'),
    boards: rows.some((r) => r.origin === 'board'),
    companySites: rows.some((r) => r.origin === 'company'),
  };
}
