import type { CompanyService, EmploymentType, RemoteKind } from '@bp/shared';
import { AppError } from '../../errors.js';
import { VACANCY_LIMITS } from '../schema.js';
import { htmlToText } from './arbeitsagentur.js';
import { safeGetBytes, SafeGetError, type SafeGetBase } from './safe-get.js';
import type { SourceDetails } from './types.js';

/**
 * The public job feeds of four applicant systems (0.14.0). Only companies the person added are read, at most once in
 * six hours each; only the company's account name leaves the PC. Taking a service out of this list switches it off.
 */
export const COMPANY_SERVICES: readonly CompanyService[] = ['greenhouse', 'lever', 'ashby', 'personio'];

/** `host`: the board's own host when the feed depends on it (Personio, Lever), else ''. */
export interface CompanyBoard { service: CompanyService; account: string; host: string }

const L = VACANCY_LIMITS;
// Ashby is the largest seen (4.4 MB: every description twice).
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_OFFERS = 500;
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/;
const PERSONIO = /^([a-z0-9][a-z0-9-]{0,59})\.jobs\.personio\.(?:de|com)$/;

/** The board behind a link to a company's job board; null = not one of the known boards (nothing is guessed). */
export function parseCompanyLink(link: string, services: readonly CompanyService[] = COMPANY_SERVICES): CompanyBoard | null {
  const raw = link.trim();
  let u: URL;
  try { u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return null;
  const host = u.hostname;
  let first: string;
  try { first = decodeURIComponent(u.pathname.split('/')[1] ?? ''); } catch { return null; }
  const found = (service: CompanyService, account: string, h = ''): CompanyBoard | null =>
    (services.includes(service) && ACCOUNT.test(account) ? { service, account, host: h } : null);
  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
    return found('greenhouse', first === 'embed' ? u.searchParams.get('for') ?? '' : first);
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') return found('lever', first, host);
  if (host === 'jobs.ashbyhq.com') return found('ashby', first);
  const p = PERSONIO.exec(host);
  return p ? found('personio', p[1], host) : null;
}

/** The page where the person can see all offers of that board. */
export function boardUrl(b: CompanyBoard): string {
  const a = encodeURIComponent(b.account);
  switch (b.service) {
    case 'greenhouse': return `https://job-boards.greenhouse.io/${a}`;
    case 'lever': return `https://${b.host}/${a}`;
    case 'ashby': return `https://jobs.ashbyhq.com/${a}`;
    case 'personio': return `https://${b.host}/`;
  }
}

export function feedUrl(b: CompanyBoard): string {
  const a = encodeURIComponent(b.account);
  switch (b.service) {
    case 'greenhouse': return `https://boards-api.greenhouse.io/v1/boards/${a}/jobs?content=true`;
    case 'lever': return `https://${b.host === 'jobs.eu.lever.co' ? 'api.eu.lever.co' : 'api.lever.co'}/v0/postings/${a}?mode=json`;
    case 'ashby': return `https://api.ashbyhq.com/posting-api/job-board/${a}`;
    case 'personio': return `https://${b.host}/xml`;
  }
}

/** The start of every sourceId of that board. */
export const boardKey = (b: Pick<CompanyBoard, 'service' | 'account'>) => `${b.service}:${b.account.toLowerCase()}:`;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

interface Raw { id: string; title: string; locations: string[]; remote?: RemoteKind; kind: string; salary?: string; date: string; url: string; fallbackUrl: string; text: string }

function toOffer(b: CompanyBoard, name: string, r: Raw): SourceDetails | null {
  if (!ID.test(r.id) || !r.title) return null;
  const locations = [...new Set(r.locations.map((l) => l.trim()).filter(Boolean))].slice(0, L.locations).map((l) => l.slice(0, L.location));
  return {
    sourceId: `${boardKey(b)}${r.id}`, title: r.title.slice(0, L.title), company: name.slice(0, L.company), locations,
    remote: r.remote ?? (locations.some((l) => /remote|home ?office/i.test(l)) ? 'yes' : 'unknown'),
    employment: employmentOf(r.kind), salaryText: (r.salary ?? '').slice(0, L.salary),
    publishedAt: /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : '', url: httpsUrl(r.url) || r.fallbackUrl, partnerUrl: '',
    text: r.text.slice(0, L.text),
  };
}

function httpsUrl(s: string): string {
  try {
    const u = new URL(s);
    const out = u.toString();
    return u.protocol === 'https:' && !u.username && !u.password && out.length <= L.url ? out : '';
  } catch { return ''; }
}

function employmentOf(kind: string): EmploymentType[] {
  const k = kind.toLowerCase().replace(/[\s_-]+/g, '');
  const out: EmploymentType[] = [];
  if (/fulltime|vollzeit|fullorparttime/.test(k)) out.push('fulltime');
  if (/parttime|teilzeit/.test(k)) out.push('parttime');
  if (/intern(?!al)|praktik/.test(k)) out.push('internship');
  if (/apprentice|trainee|ausbildung/.test(k)) out.push('apprenticeship');
  return out;
}

function isoDay(ms: unknown): string {
  const d = new Date(typeof ms === 'number' ? ms : NaN);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function greenhouse(b: CompanyBoard, body: unknown): Raw[] | null {
  const jobs = rec(body).jobs;
  if (!Array.isArray(jobs)) return null;
  return jobs.map(rec).map((j) => ({
    id: String(j.id ?? ''), title: str(j.title), locations: str(rec(j.location).name).split(/[;|]/), kind: '', date: str(j.first_published),
    url: str(j.absolute_url), fallbackUrl: `${boardUrl(b)}/jobs/${encodeURIComponent(String(j.id ?? ''))}`,
    // The content is HTML that was escaped once more.
    text: htmlToText(htmlToText(str(j.content))),
  }));
}

function lever(b: CompanyBoard, body: unknown): Raw[] | null {
  if (!Array.isArray(body)) return null;
  const remote: Record<string, RemoteKind> = { remote: 'yes', hybrid: 'partial', onsite: 'no', 'on-site': 'no' };
  return body.map(rec).map((j) => {
    const c = rec(j.categories);
    const all = list(c.allLocations).map(str).filter(Boolean);
    const salary = rec(j.salaryRange);
    const lists = list(j.lists).map(rec).map((l) => `${str(l.text)}\n${htmlToText(str(l.content))}`);
    return {
      id: str(j.id), title: str(j.text), locations: all.length > 0 ? all : [str(c.location)], remote: remote[str(j.workplaceType).toLowerCase()],
      kind: str(c.commitment), date: isoDay(j.createdAt), url: str(j.hostedUrl), fallbackUrl: `${boardUrl(b)}/${encodeURIComponent(str(j.id))}`,
      salary: typeof salary.min === 'number' && typeof salary.max === 'number' ? `${salary.min}–${salary.max} ${str(salary.currency)}`.trim() : '',
      text: [str(j.descriptionPlain) || htmlToText(str(j.description)), ...lists, str(j.additionalPlain)].filter(Boolean).join('\n\n'),
    };
  });
}

function ashby(b: CompanyBoard, body: unknown): Raw[] | null {
  const jobs = rec(body).jobs;
  if (!Array.isArray(jobs)) return null;
  const remote: Record<string, RemoteKind> = { remote: 'yes', hybrid: 'partial', onsite: 'no' };
  // isListed: false = only reachable by link, must not be shown.
  return jobs.map(rec).filter((j) => j.isListed !== false).map((j) => ({
    id: str(j.id), title: str(j.title), locations: [str(j.location), ...list(j.secondaryLocations).map((l) => str(rec(l).location))],
    remote: remote[str(j.workplaceType).toLowerCase()] ?? (j.isRemote === true ? 'yes' : undefined),
    kind: str(j.employmentType), date: str(j.publishedAt), url: str(j.jobUrl), fallbackUrl: `${boardUrl(b)}/${encodeURIComponent(str(j.id))}`,
    salary: str(rec(j.compensation).compensationTierSummary),
    text: str(j.descriptionPlain) || htmlToText(str(j.descriptionHtml)),
  }));
}

/** Every `<name>…</name>` content, in order; linear, so an unclosed tag in a hostile file costs nothing. */
function blocks(xml: string, name: string): string[] {
  const out: string[] = [];
  const open = `<${name}>`;
  const close = `</${name}>`;
  for (let at = 0; out.length < MAX_OFFERS;) {
    const start = xml.indexOf(open, at);
    if (start < 0) break;
    const end = xml.indexOf(close, start + open.length);
    if (end < 0) break;
    out.push(xml.slice(start + open.length, end));
    at = end + close.length;
  }
  return out;
}

const XML: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function xmlText(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('<![CDATA[') && t.endsWith(']]>')) return t.slice(9, -3).trim();
  return t.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML[e]);
}

/** Personio's XML: flat, read without an XML library; a DTD (entities) is refused. */
function personio(b: CompanyBoard, xml: string): Raw[] | null {
  if (!xml.includes('<workzag-jobs') || /<!(?:DOCTYPE|ENTITY)/i.test(xml)) return null;
  return blocks(xml, 'position').map((p) => {
    const cut = p.indexOf('<jobDescriptions>');
    const end = p.indexOf('</jobDescriptions>');
    const descriptions = cut >= 0 && end > cut ? p.slice(cut, end) : '';
    // The descriptions have <name> tags of their own.
    const rest = descriptions ? p.slice(0, cut) + p.slice(end) : p;
    const one = (n: string) => xmlText(blocks(rest, n)[0] ?? '');
    const id = one('id');
    return {
      id, title: one('name'), locations: blocks(rest, 'office').map(xmlText), kind: `${one('schedule')} ${one('employmentType')}`,
      date: one('createdAt'), url: '', fallbackUrl: `https://${b.host}/job/${encodeURIComponent(id)}`,
      text: blocks(descriptions, 'jobDescription')
        .map((d) => [xmlText(blocks(d, 'name')[0] ?? ''), htmlToText(xmlText(blocks(d, 'value')[0] ?? ''))].filter(Boolean).join('\n')).join('\n\n'),
    };
  });
}

/** null = not the expected form. A single unusable offer is left out. */
export function parseFeed(b: CompanyBoard, name: string, body: string): SourceDetails[] | null {
  let raws: Raw[] | null;
  if (b.service === 'personio') raws = personio(b, body);
  else {
    let json: unknown;
    try { json = JSON.parse(body); } catch { return null; }
    raws = b.service === 'greenhouse' ? greenhouse(b, json) : b.service === 'lever' ? lever(b, json) : ashby(b, json);
  }
  return raws?.slice(0, MAX_OFFERS).map((r) => toOffer(b, name, r)).filter((o): o is SourceDetails => o !== null) ?? null;
}

export interface FeedOptions extends Pick<SafeGetBase, 'check' | 'lookup' | 'isPublic'> {
  /** Test mode: `<testBase>/feeds/<service>/<account>` instead of the real service. */
  testBase?: string;
}

/** All offers of a board. Throws SOURCE_UNAVAILABLE (reason companyRead) or LLM_CANCELLED. */
export async function readFeed(b: CompanyBoard, name: string, signal: AbortSignal, opts: FeedOptions = {}): Promise<SourceDetails[]> {
  const { testBase, ...net } = opts;
  const url = testBase ? `${testBase}/feeds/${b.service}/${encodeURIComponent(b.account)}` : feedUrl(b);
  let body: string;
  try {
    body = new TextDecoder().decode(await safeGetBytes(url, { ...net, maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, signal, allowHosts: [new URL(url).hostname] }));
  } catch (err) {
    if (signal.aborted) throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
    throw new AppError('SOURCE_UNAVAILABLE', `${b.service}: ${err instanceof SafeGetError ? err.why : 'network'}`, 'companyRead');
  }
  const offers = parseFeed(b, name, body);
  if (!offers) throw new AppError('SOURCE_UNAVAILABLE', `${b.service}: unexpected answer`, 'companyRead');
  return offers;
}
