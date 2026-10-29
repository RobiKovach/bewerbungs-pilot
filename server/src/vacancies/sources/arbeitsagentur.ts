import type { EmploymentType, RemoteKind } from '@bp/shared';
import { AppError } from '../../errors.js';
import { jobdetailUrl, partnerLink } from '../aa-links.js';
import { VACANCY_LIMITS } from '../schema.js';
import type { OfferKind, SearchQuery, SourceDetails, SourceHit, VacancySource, WorkTime } from './types.js';

const L = VACANCY_LIMITS;
export const AA_BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service';
const HEADERS = { 'X-API-Key': 'jobboerse-jobsuche', Accept: 'application/json' };
const PAGE_SIZE = 50;
const MAX_PAGES = 2;
const OFFER_KIND: Record<OfferKind, string> = { work: '1', apprenticeship: '4', internship: '34' };
const WORK_TIME: Record<WorkTime, string> = { fulltime: 'vz', parttime: 'tz', minijob: 'mj' };

type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;
const realSleep: Sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export { jobdetailUrl };

/**
 * The Referenznummer from a link the person pasted — only for exactly https://www.arbeitsagentur.de/jobsuche/jobdetail/<refnr>.
 * The server never opens the link itself; it asks the API for this number.
 *
 * The live probe (2026-09-28) found real Referenznummer values containing not just letters/digits/hyphens
 * but also `_`, `.` and `:` (e.g. "13635-js_bc_85_JB5198077-S", "21037-k63204.1054-S", "15054-0001250:01-S"),
 * so the character class is wider than a first guess would suggest. `/` is still excluded, and the URL
 * parser itself collapses `..` path segments before this regex ever sees them, so path traversal stays refused.
 */
export function jobdetailRefnr(url: string): string | null {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'www.arbeitsagentur.de' || u.port !== '' || u.username || u.password) return null;
  const m = /^\/jobsuche\/jobdetail\/([A-Za-z0-9_.:-]{5,40})\/?$/.exec(u.pathname);
  return m ? m[1] : null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Repeats `step` until the text stops changing — at most 20 times, so deep nesting cannot make it slow (the result is plain text, never HTML). */
function untilStable(text: string, step: (t: string) => string): string {
  for (let i = 0, prev = ''; i < 20 && prev !== text; i++) { prev = text; text = step(text); }
  return text;
}

/**
 * Offer descriptions may come as Markdown (the live probe on 2026-09-28 found real
 * descriptions written as Markdown, e.g. "## Entwickeln Sie ...") or as simple HTML.
 * Only tag-shaped HTML markup (`<p>`, `</li>`, `<br/>`, ...) is stripped; Markdown syntax
 * that merely looks like it starts with `<` — an autolink `<https://...>`, an angle-bracket
 * address `<jobs@x.example>`, or a plain `a < b` comparison — is left untouched, because a
 * real tag always starts with `<` (or `</`) directly followed by a letter and never by `@`,
 * `:`, a digit-first token, or a bare space. Plain text keeps paragraphs and list items readable.
 */
export function htmlToText(html: string): string {
  // Removing a block or tag can join its two halves into a new one (`<scr<script></script>ipt>`), so strip until nothing changes.
  const blocks = untilStable(html, (t) => t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ''));
  const spaced = blocks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|ul|ol)>/gi, '\n\n');
  return untilStable(spaced, (t) => t.replace(/<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/gi, ''))
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : all;
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trim();
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * The live probe (2026-09-28) found `homeofficetyp` only ever `NACH_VEREINBARUNG` (degree left open) or
 * `ANGABE_IN_PROZENT` (a `homeofficeprozent` 0-100 number is given alongside it) — never a "fully remote"
 * enum value as the brief's fixture assumed. So "yes" is decided from the percentage, not from the type text.
 */
function remoteOf(raw: Record<string, unknown>): RemoteKind {
  if (raw.homeofficemoeglich === true) {
    const prozent = typeof raw.homeofficeprozent === 'number' ? raw.homeofficeprozent : null;
    return prozent !== null && prozent >= 100 ? 'yes' : 'partial';
  }
  if (raw.homeofficemoeglich === false) return 'no';
  return 'unknown';
}

/**
 * The live probe (2026-09-28) confirmed `arbeitszeitVollzeit` and several `arbeitszeitTeilzeit*` booleans
 * (Vormittag/Nachmittag/Abend/Flexibel/...), but there is no `arbeitszeitMinijob` field at all — a minijob
 * offer is instead marked by `istGeringfuegigeBeschaeftigung: true`.
 */
function employmentOf(raw: Record<string, unknown>): EmploymentType[] {
  const out: EmploymentType[] = [];
  if (raw.arbeitszeitVollzeit === true) out.push('fulltime');
  if (Object.entries(raw).some(([k, v]) => k.startsWith('arbeitszeitTeilzeit') && v === true)) out.push('parttime');
  if (raw.istGeringfuegigeBeschaeftigung === true) out.push('minijob');
  return out;
}

function salaryOf(raw: Record<string, unknown>): string {
  const from = typeof raw.gehaltsspanneVon === 'number' ? raw.gehaltsspanneVon : null;
  const to = typeof raw.gehaltsspanneBis === 'number' ? raw.gehaltsspanneBis : null;
  if (from !== null && to !== null) return `${from}–${to} €`;
  if (from !== null) return `ab ${from} €`;
  if (to !== null) return `bis ${to} €`;
  return '';
}

function locationsOf(raw: Record<string, unknown>): string[] {
  const list = Array.isArray(raw.stellenlokationen) ? raw.stellenlokationen : [];
  const names = list.map((l) => str((l as { adresse?: { ort?: unknown } } | null)?.adresse?.ort)).filter(Boolean);
  return [...new Set(names)];
}

/**
 * null = not usable (no Referenznummer, or one so long it cannot be a real one — treated the same as "no number").
 * Unknown / missing optional fields get neutral defaults. Every string field is clipped to what the vacancy store
 * accepts (VACANCY_LIMITS) so that one oversized offer from the source can never make a later `store.add` fail —
 * that would end the whole search as `failed` and, worse, leak card data into the validation error text.
 */
function toHit(raw: unknown): SourceHit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const sourceId = str(r.referenznummer);
  if (!sourceId || sourceId.length > L.sourceId) return null;
  const url = jobdetailUrl(sourceId);
  return {
    sourceId,
    title: str(r.stellenangebotsTitel).slice(0, L.title),
    company: str(r.firma).slice(0, L.company),
    locations: locationsOf(r).slice(0, L.locations).map((l) => l.slice(0, L.location)),
    remote: remoteOf(r),
    employment: employmentOf(r),
    salaryText: salaryOf(r).slice(0, L.salary),
    publishedAt: /^\d{4}-\d{2}-\d{2}/.test(str(r.datumErsteVeroeffentlichung)) ? str(r.datumErsteVeroeffentlichung).slice(0, 10) : '',
    // jobdetailUrl() of a ≤64-char sourceId is always well under L.url, so it is always a safe fallback URL.
    url,
  };
}

export function buildSearchUrl(q: SearchQuery, page: number): string {
  const p = new URLSearchParams({ was: q.jobTitle });
  if (q.location) {
    p.set('wo', q.location);
    if (q.radiusKm !== null) p.set('umkreis', String(q.radiusKm));
  }
  p.set('veroeffentlichtseit', String(q.publishedWithinDays));
  p.set('angebotsart', OFFER_KIND[q.kind]);
  if (q.kind === 'work' && q.workTimes.length > 0) p.set('arbeitszeit', q.workTimes.map((w) => WORK_TIME[w]).join(';'));
  if (!q.includeTemporaryAgencies) p.set('zeitarbeit', 'false');
  p.set('size', String(PAGE_SIZE));
  p.set('page', String(page));
  return `${AA_BASE}/pc/v6/jobs?${p}`;
}

export class ArbeitsagenturSource implements VacancySource {
  readonly id = 'arbeitsagentur' as const;
  private readonly fetch: typeof fetch;
  private readonly sleep: Sleep;
  private readonly timeoutMs: number;

  constructor(opts: { fetch?: typeof fetch; sleep?: Sleep; timeoutMs?: number } = {}) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? realSleep;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async search(q: SearchQuery, signal: AbortSignal): Promise<SourceHit[]> {
    const hits: SourceHit[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.getJson(buildSearchUrl(q, page), signal, false);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('SOURCE_CHANGED', 'search answer is not an object');
      const list = (body as { ergebnisliste?: unknown }).ergebnisliste;
      if (list === undefined) break; // no results: the API leaves the list out
      if (!Array.isArray(list)) throw new AppError('SOURCE_CHANGED', 'ergebnisliste is not an array');
      for (const raw of list) {
        const hit = toHit(raw);
        if (hit) hits.push(hit);
      }
      if (list.length < PAGE_SIZE) break;
    }
    return hits;
  }

  async details(sourceId: string, signal: AbortSignal): Promise<SourceDetails | null> {
    const body = await this.getJson(`${AA_BASE}/pc/v4/jobdetails/${Buffer.from(sourceId).toString('base64')}`, signal, true);
    if (body === null) return null;
    if (typeof body !== 'object' || Array.isArray(body)) throw new AppError('SOURCE_CHANGED', 'details answer is not an object');
    const r = body as Record<string, unknown>;
    const hit = toHit({ ...r, referenznummer: str(r.referenznummer) || sourceId });
    if (!hit) return null; // an unusable Referenznummer in the answer — same as "not found"
    // The card always links to the offer on the Arbeitsagentur site; a partner page is kept beside it (0.9.1 — the
    // API often names the Arbeitsagentur home page as the partner, which used to replace the link).
    return { ...hit, partnerUrl: partnerLink(str(r.allianzpartnerUrl), L.url), text: htmlToText(str(r.stellenangebotsBeschreibung)) };
  }

  async isOnline(sourceId: string, signal: AbortSignal): Promise<boolean> {
    return (await this.details(sourceId, signal)) !== null;
  }

  /** JSON of a GET; null only for 404 when `notFoundIsNull`. One retry for network errors, 5xx and 429. */
  private async getJson(url: string, signal: AbortSignal, notFoundIsNull: boolean): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw new AppError('LLM_CANCELLED', 'search stopped', 'cancelledByUser');
      let res: Response;
      try {
        res = await this.fetch(url, { headers: HEADERS, signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) });
      } catch (err) {
        if (signal.aborted) throw new AppError('LLM_CANCELLED', 'search stopped', 'cancelledByUser');
        if (attempt === 0) { await this.sleep(1000, signal); continue; }
        throw new AppError('SOURCE_UNAVAILABLE', `network: ${String(err).slice(0, 200)}`);
      }
      if (res.ok) {
        try { return await res.json(); } catch { throw new AppError('SOURCE_CHANGED', `not JSON (HTTP ${res.status})`); }
      }
      if (res.status === 404 && notFoundIsNull) return null;
      if (res.status === 429) {
        if (attempt === 0) { await this.sleep(5000, signal); continue; }
        throw new AppError('SOURCE_RATE_LIMITED', 'HTTP 429');
      }
      if (res.status >= 500) {
        if (attempt === 0) { await this.sleep(1000, signal); continue; }
        throw new AppError('SOURCE_UNAVAILABLE', `HTTP ${res.status}`);
      }
      throw new AppError('SOURCE_CHANGED', `HTTP ${res.status}`);
    }
  }
}
