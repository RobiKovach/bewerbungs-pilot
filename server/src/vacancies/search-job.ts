import crypto from 'node:crypto';
import type { ErrorCode, FilterReason, Language, Profile, SearchState, SearchWarning, Vacancy, WishesData } from '@bp/shared';
import { CorruptJsonError, readJson, writeJsonAtomic } from '../data/atomic.js';
import { AppError } from '../errors.js';
import type { LlmQueue } from '../llm/queue.js';
import type { Logger } from '../log.js';
import { findDuplicate } from './dedup.js';
import { filterHits } from './filter.js';
import type { OfferKind, SearchQuery, SourceHit, VacancySource, WorkTime } from './sources/types.js';
import type { VacancyStore } from './store.js';
import { SCORE_BATCH, scoreTask, toScores, type ScoreInput, type ScoreOutput } from './tasks/score.js';

export const MAX_QUERIES = 30;
export const MAX_NEW_PER_SEARCH = 50;
export const MAX_STALE_CHECKS = 100;
const WORK_TIMES: readonly WorkTime[] = ['fulltime', 'parttime', 'minijob'];

export function assertWishesComplete(w: WishesData): void {
  const titles = w.jobTitles.some((t) => t.trim());
  const where = w.locations.some((l) => l.trim()) || w.remote === 'remote';
  if (!titles || !where) throw new AppError('WISHES_INCOMPLETE', `titles=${titles} where=${where}`);
}

export function planQueries(w: WishesData, publishedWithinDays: number): { queries: SearchQuery[]; truncated: boolean } {
  const titles = [...new Set(w.jobTitles.map((t) => t.trim()).filter(Boolean))];
  const places: (string | null)[] = w.remote === 'remote' ? [null] : [...new Set(w.locations.map((l) => l.trim()).filter(Boolean))];
  const workTimes = WORK_TIMES.filter((t) => w.employmentTypes.includes(t));
  const kinds: OfferKind[] = [];
  if (workTimes.length > 0 || !w.employmentTypes.some((t) => t === 'apprenticeship' || t === 'internship')) kinds.push('work');
  if (w.employmentTypes.includes('apprenticeship')) kinds.push('apprenticeship');
  if (w.employmentTypes.includes('internship')) kinds.push('internship');
  const all: SearchQuery[] = [];
  for (const jobTitle of titles) for (const location of places) for (const kind of kinds) {
    all.push({
      jobTitle, location, radiusKm: location === null ? null : w.radiusKm, kind, workTimes: kind === 'work' ? workTimes : [],
      publishedWithinDays, includeTemporaryAgencies: w.includeTemporaryAgencies,
    });
  }
  return { queries: all.slice(0, MAX_QUERIES), truncated: all.length > MAX_QUERIES };
}

/**
 * The new offers one search takes: round-robin over the job titles (1st title's first offer, 2nd title's first, …),
 * so with several titles the first one cannot fill every slot. A title with fewer offers drops out of the rotation;
 * within one title the order stays as the source returned it. `titleOf` is the title whose query found the offer first.
 */
export function takeFairly<T>(passed: readonly T[], titleOf: (h: T) => string, titles: readonly string[], limit: number): T[] {
  const groups = new Map<string, T[]>(titles.map((t) => [t, []]));
  for (const h of passed) {
    const t = titleOf(h);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(h);
  }
  const lists = [...groups.values()];
  const out: T[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < limit) out.push(l[i]);
  }
  return out;
}

export function idleState(): SearchState {
  return {
    state: 'idle', phase: null, found: 0, filteredOut: {}, afterFilter: 0, toScore: 0, scored: 0, moreAvailable: 0,
    warnings: [], error: null, startedAt: null, finishedAt: null,
  };
}

export interface SearchJobDeps {
  store: VacancyStore; source: VacancySource; queue: LlmQueue; logger: Logger;
  profile: () => Profile; language: () => Language; publishedWithinDays: () => number;
  stateFile: string;
  newId?: () => string; now?: () => Date;
  /** Pause between two details requests (ms). Default 300; tests pass 0. */
  pauseMs?: number;
}

/** AI errors that end the whole scoring phase instead of failing one batch. */
const STOPS_SCORING: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['LLM_LIMIT', 'LLM_NOT_CHOSEN', 'LLM_NOT_INSTALLED', 'LLM_NOT_LOGGED_IN']);

const isCancel = (err: unknown, signal: AbortSignal) => signal.aborted || (err instanceof AppError && err.code === 'LLM_CANCELLED');

/** Finds, filters, stores and scores offers in the background (spec, section 3). One search at a time. */
export class SearchJob {
  private current: SearchState = idleState();
  private ctrl: AbortController | null = null;
  private running: Promise<void> = Promise.resolve();
  /** Cards created by the current run, in order. */
  private created: string[] = [];
  private readonly newId: () => string;
  private readonly now: () => Date;
  private readonly pauseMs: number;

  constructor(private readonly d: SearchJobDeps) {
    this.newId = d.newId ?? (() => crypto.randomUUID());
    this.now = d.now ?? (() => new Date());
    this.pauseMs = d.pauseMs ?? 300;
  }

  init(): void {
    let saved: SearchState | null = null;
    try {
      saved = readJson<SearchState>(this.d.stateFile);
    } catch (err) {
      if (!(err instanceof CorruptJsonError)) throw err;
      this.d.logger.warn('search_state_corrupt', {});
    }
    this.current = saved && typeof saved === 'object' && typeof saved.state === 'string' ? { ...idleState(), ...saved } : idleState();
    if (this.current.state === 'running') {
      this.current = { ...this.current, state: 'interrupted', phase: null, finishedAt: this.stamp() };
      this.persist();
    }
    const pending = this.d.store.list().filter((v) => v.scoreState === 'pending').map((v) => v.id);
    this.d.store.updateMany(pending, (v) => { v.scoreState = 'notScored'; });
    this.d.store.compactHidden();
  }

  state(): SearchState {
    return structuredClone(this.current);
  }

  start(): void {
    if (this.current.state === 'running') throw new AppError('SEARCH_ALREADY_RUNNING', 'a search is running');
    assertWishesComplete(this.d.profile().sections.wishes.data);
    this.ctrl = new AbortController();
    this.created = [];
    this.set({ ...idleState(), state: 'running', startedAt: this.stamp() });
    this.d.logger.info('search_started', {});
    this.running = this.run(this.ctrl.signal).catch((err: unknown) => this.finishWithError(err, this.ctrl?.signal));
  }

  stop(): void {
    this.ctrl?.abort();
  }

  whenIdle(): Promise<void> {
    return this.running;
  }

  private async run(signal: AbortSignal): Promise<void> {
    this.d.store.compactHidden();
    const profile = this.d.profile();
    const wishes = profile.sections.wishes.data;
    const warnings = new Set<SearchWarning>();

    // 1. Queries
    this.set({ phase: 'querying' });
    const { queries, truncated } = planQueries(wishes, this.d.publishedWithinDays());
    if (truncated) warnings.add('tooManyQueries');
    const hits = new Map<string, SourceHit>();
    const titleOf = new Map<string, string>();
    let failures = 0;
    let lastError: unknown = null;
    for (const q of queries) {
      try {
        for (const h of await this.d.source.search(q, signal)) {
          if (!hits.has(h.sourceId)) { hits.set(h.sourceId, h); titleOf.set(h.sourceId, q.jobTitle); }
        }
      } catch (err) {
        if (isCancel(err, signal)) throw err;
        failures++;
        lastError = err;
        warnings.add('someQueriesFailed');
        this.d.logger.warn('search_query_failed', { code: err instanceof AppError ? err.code : 'UNKNOWN' });
      }
    }
    if (queries.length > 0 && failures === queries.length) throw lastError;

    // 2. Filter + limit
    const { passed, rejected } = filterHits([...hits.values()], profile, this.d.store.list());
    const filteredOut: Partial<Record<FilterReason, number>> = {};
    for (const r of rejected) filteredOut[r.reason] = (filteredOut[r.reason] ?? 0) + 1;
    const titles = [...new Set(queries.map((q) => q.jobTitle))];
    const take = takeFairly(passed, (h) => titleOf.get(h.sourceId) ?? '', titles, MAX_NEW_PER_SEARCH);
    let toScore = take.length;
    this.set({ found: hits.size, filteredOut, afterFilter: passed.length, toScore, moreAvailable: passed.length - take.length, warnings: [...warnings] });

    // 3. Texts → cards
    this.set({ phase: 'details' });
    for (const [i, h] of take.entries()) {
      if (i > 0 && this.pauseMs > 0) await pause(this.pauseMs, signal);
      let full;
      try {
        full = await this.d.source.details(h.sourceId, signal);
      } catch (err) {
        if (isCancel(err, signal)) throw err;
        warnings.add('someQueriesFailed');
        full = null;
      }
      if (!full || findDuplicate(this.d.store.list(), full)) {
        toScore--;
        this.set({ toScore, warnings: [...warnings] });
        continue;
      }
      let card;
      try {
        card = this.d.store.add(this.cardFrom(full), full.text);
      } catch (err) {
        if (isCancel(err, signal)) throw err;
        toScore--;
        warnings.add('someQueriesFailed');
        this.d.logger.warn('search_offer_skipped', { code: err instanceof AppError ? err.code : 'UNKNOWN' });
        this.set({ toScore, warnings: [...warnings] });
        continue;
      }
      this.created.push(card.id);
    }

    // 4. Scores
    this.set({ phase: 'scoring' });
    let scored = 0;
    for (let i = 0; i < this.created.length; i += SCORE_BATCH) {
      const ids = this.created.slice(i, i + SCORE_BATCH);
      const batch = ids.map((id) => this.d.store.get(id)).filter((v): v is Vacancy => v !== undefined && v.scoreState === 'pending');
      if (batch.length > 0) await this.scoreBatch(batch, profile, signal);
      scored += ids.length;
      this.set({ scored });
    }

    // 5. Removed offers
    this.set({ phase: 'staleCheck' });
    const createdSet = new Set(this.created);
    const candidates = this.d.store.list()
      .filter((v) => v.status === 'new' && v.source === 'arbeitsagentur' && v.sourceId && !hits.has(v.sourceId) && !createdSet.has(v.id))
      .sort((a, b) => a.foundAt.localeCompare(b.foundAt))
      .slice(0, MAX_STALE_CHECKS);
    for (const [i, v] of candidates.entries()) {
      if (i > 0 && this.pauseMs > 0) await pause(this.pauseMs, signal);
      try {
        if (!(await this.d.source.isOnline(v.sourceId as string, signal))) {
          this.d.store.updateMany([v.id], (x) => { if (x.status === 'new') x.status = 'stale'; });
        }
      } catch (err) {
        if (isCancel(err, signal)) throw err;
        warnings.add('staleCheckFailed');
      }
    }

    this.set({ state: 'done', phase: null, warnings: [...warnings], finishedAt: this.stamp() });
    this.d.logger.info('search_finished', { found: hits.size, toScore, scored });
  }

  private async scoreBatch(batch: Vacancy[], profile: Profile, signal: AbortSignal): Promise<void> {
    const inputs: ScoreInput[] = batch.map((v) => ({
      id: v.id, title: v.title, company: v.company, locations: v.locations, remote: v.remote, employment: v.employment,
      salaryText: v.salaryText, text: this.d.store.readText(v.id) ?? '',
    }));
    const ids = batch.map((v) => v.id);
    try {
      const language = this.d.language();
      const r = await this.d.queue.runTagged<ScoreOutput>(scoreTask(inputs, profile, language), signal);
      const scores = toScores(r.value, ids, this.stamp(), r.provider, language);
      this.d.store.updateMany(ids, (v) => {
        const s = scores.get(v.id);
        v.score = s ?? null;
        v.scoreState = s ? 'scored' : 'failed';
      });
    } catch (err) {
      if (isCancel(err, signal)) throw err;
      // Neither comes back during this search: stop instead of burning the next batches (spec §8). finishWithError
      // marks the cards still pending (this batch included) as notScored and keeps the code for the page.
      if (err instanceof AppError && STOPS_SCORING.has(err.code)) throw err;
      this.d.logger.warn('search_batch_failed', { code: err instanceof AppError ? err.code : 'UNKNOWN', size: ids.length });
      this.d.store.updateMany(ids, (v) => { v.scoreState = 'failed'; });
    }
  }

  private cardFrom(h: SourceHit): Vacancy {
    return {
      id: this.newId(), source: 'arbeitsagentur', sourceId: h.sourceId, addedManually: false, title: h.title, company: h.company,
      locations: h.locations, remote: h.remote, employment: h.employment, salaryText: h.salaryText, publishedAt: h.publishedAt,
      foundAt: this.stamp(), url: h.url, contact: null, hasText: false, status: 'new', scoreState: 'pending', score: null, hiddenAt: null,
    };
  }

  private finishWithError(err: unknown, signal: AbortSignal | undefined): void {
    const pending = this.created.filter((id) => this.d.store.get(id)?.scoreState === 'pending');
    try {
      this.d.store.updateMany(pending, (v) => { v.scoreState = 'notScored'; });
    } catch (e) {
      this.d.logger.error('search_cleanup_failed', { message: String(e) });
    }
    if (signal && isCancel(err, signal)) {
      this.set({ state: 'stopped', phase: null, finishedAt: this.stamp() });
      this.d.logger.info('search_stopped', {});
      return;
    }
    const code = err instanceof AppError ? err.code : 'UNKNOWN';
    // Capped and kept only in the persisted/returned state, never in the log: validation errors echo card data
    // (see toHit's clipping comment), so a log line must carry the code only.
    const detailsForLog = (err instanceof AppError ? err.detailsForLog : String(err)).slice(0, 300);
    this.set({ state: 'failed', phase: null, error: { code, detailsForLog }, finishedAt: this.stamp() });
    this.d.logger.error('search_failed', { code });
  }

  private set(patch: Partial<SearchState>): void {
    this.current = { ...this.current, ...patch };
    this.persist();
  }

  private persist(): void {
    try {
      writeJsonAtomic(this.d.stateFile, this.current);
    } catch (err) {
      this.d.logger.warn('search_state_write_failed', { message: String(err) });
    }
  }

  private stamp(): string {
    return this.now().toISOString();
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
