import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Company, CompanyView, WishesData } from '@bp/shared';
import { CorruptJsonError, readJson, writeJsonAtomic } from '../data/atomic.js';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';
import { normalizeTitle } from './dedup.js';
import { boardKey, boardUrl, COMPANY_SERVICES, parseCompanyLink, readFeed, type CompanyBoard, type FeedOptions } from './sources/company-feeds.js';
import type { SourceDetails } from './sources/types.js';

export const MAX_COMPANIES = 20;
/** Gentle use: one company is asked at most once in this time; in between the offers are kept in memory. */
export const FEED_EVERY_MS = 6 * 3600_000;

export interface CompanyOffers {
  offers: SourceDetails[];
  /** The boards that could be read: only there a missing offer means it was removed. */
  readKeys: string[];
  failed: number;
}

/** The companies the person follows (`vacancies/companies.json`) and their current offers. */
export class Companies {
  private items: Company[] = [];
  private readonly cache = new Map<string, { at: number; offers: SourceDetails[] }>();

  constructor(private readonly d: { file: string; logger: Logger; feed?: FeedOptions; read?: typeof readFeed; now?: () => Date }) {}

  load(): void {
    this.cache.clear();
    this.items = [];
    let raw: unknown;
    try {
      raw = readJson<unknown>(this.d.file);
    } catch (err) {
      if (!(err instanceof CorruptJsonError)) throw err;
      this.setAside();
      return;
    }
    if (raw === null || raw === undefined) return;
    const list = (raw as { companies?: unknown }).companies;
    if (!Array.isArray(list)) { this.setAside(); return; }
    // A broken entry costs only itself.
    this.items = list.filter(isCompany).slice(0, MAX_COMPANIES);
  }

  list(): CompanyView[] {
    return this.items.map((c) => ({ ...c, url: boardUrl(c), offers: this.cache.get(c.id)?.offers.length ?? null }));
  }

  /** Reads the board once, to be sure it exists. */
  async add(link: string, rawName: string, signal: AbortSignal): Promise<void> {
    const name = rawName.trim();
    const board = parseCompanyLink(link);
    if (!board) throw new AppError('BAD_REQUEST', 'not a known job board link', 'companyLink');
    this.assertAddable(board);
    const offers = await this.read(board, name, signal);
    // Another tab may have added it while the board was read.
    this.assertAddable(board);
    const at = this.stamp();
    const c: Company = { id: crypto.randomUUID(), name, ...board, addedAt: at, lastReadAt: at, lastReadFailed: false };
    this.save([...this.items, c]);
    this.cache.set(c.id, { at: this.ms(), offers });
  }

  /** The cards found through the company stay. */
  remove(id: string): void {
    if (!this.items.some((c) => c.id === id)) throw new AppError('NOT_FOUND', id);
    this.save(this.items.filter((c) => c.id !== id));
    this.cache.delete(id);
  }

  /** The offers of every followed company; a company that cannot be read is only counted. */
  async readAll(signal: AbortSignal): Promise<CompanyOffers> {
    const out: CompanyOffers = { offers: [], readKeys: [], failed: 0 };
    for (const c of [...this.items]) {
      if (!COMPANY_SERVICES.includes(c.service)) continue;
      const known = this.cache.get(c.id);
      const age = known ? this.ms() - known.at : NaN;
      let offers = known && age >= 0 && age < FEED_EVERY_MS ? known.offers : null;
      if (!offers) {
        try {
          offers = await this.read(c, c.name, signal);
          this.mark(c.id, false);
          if (this.items.some((x) => x.id === c.id)) this.cache.set(c.id, { at: this.ms(), offers });
        } catch (err) {
          if (signal.aborted) throw err;
          this.d.logger.warn('company_feed_failed', { service: c.service, why: err instanceof AppError ? err.detailsForLog : 'unknown' });
          this.mark(c.id, true);
          out.failed++;
          continue;
        }
      }
      out.offers.push(...offers);
      out.readKeys.push(boardKey(c));
    }
    return out;
  }

  private read(b: CompanyBoard, name: string, signal: AbortSignal): Promise<SourceDetails[]> {
    return (this.d.read ?? readFeed)({ service: b.service, account: b.account, host: b.host }, name, signal, this.d.feed);
  }

  private mark(id: string, failed: boolean): void {
    if (!this.items.some((c) => c.id === id)) return;
    try {
      this.save(this.items.map((c) => (c.id !== id ? c : { ...c, lastReadFailed: failed, ...(failed ? {} : { lastReadAt: this.stamp() }) })));
    } catch {
      // Only the "last read" line: never worth a failed search.
      this.d.logger.warn('company_mark_failed', {});
    }
  }

  private assertAddable(b: CompanyBoard): void {
    if (this.items.some((c) => boardKey(c) === boardKey(b))) throw new AppError('CONFLICT', 'already followed', 'companyExists');
    if (this.items.length >= MAX_COMPANIES) throw new AppError('CONFLICT', 'too many companies', 'companyLimit');
  }

  private save(next: Company[]): void {
    fs.mkdirSync(path.dirname(this.d.file), { recursive: true });
    writeJsonAtomic(this.d.file, { schemaVersion: 1, companies: next });
    this.items = next;
  }

  private setAside(): void {
    this.d.logger.warn('companies_corrupt', {});
    fs.renameSync(this.d.file, path.join(path.dirname(this.d.file), `companies.corrupt-${this.ms()}.json`));
  }

  private ms(): number { return (this.d.now?.() ?? new Date()).getTime(); }
  private stamp(): string { return new Date(this.ms()).toISOString(); }
}

function isCompany(x: unknown): x is Company {
  const c = x as Partial<Company> | null;
  if (!c || typeof c !== 'object') return false;
  if (![c.id, c.name, c.account, c.host, c.addedAt].every((s) => typeof s === 'string') || !c.id || !c.name) return false;
  if ((c.lastReadAt !== null && typeof c.lastReadAt !== 'string') || typeof c.lastReadFailed !== 'boolean') return false;
  // The file never decides which address is asked: the board must be the one its own page link gives.
  let link: string | undefined;
  try { link = boardUrl(c as Company); } catch { return false; }
  const b = link === undefined ? null : parseCompanyLink(link, ['greenhouse', 'lever', 'ashby', 'personio']);
  return b !== null && b.service === c.service && b.account === c.account && b.host === c.host;
}

/** Words that say nothing about the profession. */
const GENERIC = new Set(['senior', 'junior', 'lead', 'head', 'manager', 'mitarbeiter', 'specialist', 'spezialist', 'expert', 'experte', 'fachkraft', 'leiter',
  'assistent', 'assistant', 'consultant', 'berater', 'und', 'and', 'für', 'for', 'mit', 'with', 'the', 'der', 'die', 'das', 'all', 'genders', 'remote', 'vollzeit', 'teilzeit']);
const titleWords = (s: string) => normalizeTitle(s).split(' ').filter((w) => w.length >= 2);

function significant(title: string): string[] {
  const all = titleWords(title);
  const strong = all.filter((w) => !GENERIC.has(w));
  return strong.length > 0 ? strong : all;
}

/** Equal, or one inside the other from 5 letters on: "Entwickler" / "Webentwickler". */
const related = (a: string, b: string) => a === b || (a.length >= 5 && b.includes(a)) || (b.length >= 5 && a.includes(b));

const CITY_EN: Record<string, string> = { münchen: 'munich', köln: 'cologne', nürnberg: 'nuremberg', hannover: 'hanover', braunschweig: 'brunswick', wien: 'vienna', zürich: 'zurich' };
/** A place that names no city says nothing against the offer. */
const NO_CITY = /^(?:germany|deutschland|deutschlandweit|bundesweit|dach|europe|europa|emea|eu|european union|worldwide|multiple locations|various|mehrere standorte)$/i;

/**
 * Company boards have no search of their own, so the app looks: the title shares a telling word with a wished title, and
 * the place names a wished city, is remote, or is not known. No radius: boards give no coordinates.
 */
export function fitsWishes(o: Pick<SourceDetails, 'title' | 'locations' | 'remote'>, w: Pick<WishesData, 'jobTitles' | 'locations' | 'remote'>): boolean {
  const title = titleWords(o.title);
  if (!w.jobTitles.some((t) => significant(t).some((s) => title.some((x) => related(s, x))))) return false;
  // With "remote only" wished, the ordinary filter decides by the remote field.
  if (o.remote === 'yes' || o.locations.length === 0 || w.remote === 'remote') return true;
  const cities = w.locations.map((l) => l.trim().toLowerCase()).filter(Boolean).flatMap((l) => (CITY_EN[l] ? [l, CITY_EN[l]] : [l]));
  if (cities.length === 0) return true;
  return o.locations.some((l) => NO_CITY.test(l.trim()) || cities.some((c) => l.toLowerCase().includes(c)));
}
