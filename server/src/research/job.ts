import type { CompanyResearch, ErrorCode, Language, Vacancy } from '@bp/shared';
import { AppError } from '../errors.js';
import type { LlmQueue } from '../llm/queue.js';
import type { Logger } from '../log.js';
import type { Activity } from '../runtime/activity.js';
import type { PageReader } from '../vacancies/sources/page-reader.js';
import type { VacancyStore } from '../vacancies/store.js';
import { collect, type CollectInput } from './collect.js';
import { mergeContact } from './contact-merge.js';
import { withNameFromPages } from '../vacancies/contact-find.js';
import type { fetchNews as FetchNews } from './news.js';
import { companyResearchTask, toResearch, type ResearchOutput } from './task.js';

/**
 * Company research in the background (0.13.0, spec 3.3): one at a time, the rest waits in line (`queued`). Adding a
 * card or making a package never waits for it. The card's `research.state` goes queued → running → done | failed;
 * the result and the found contact are written only while the card still exists and is not hidden. A filled contact
 * field is never changed (mergeContact); fields filled here are marked in `contactAuto`.
 */

export interface ResearchJobDeps {
  store: VacancyStore;
  /** Wrapped with `browserWork` in production: a running session counts as browser work for an update. */
  reader: PageReader;
  /** null: news off — nothing is asked (0.13.0). */
  fetchNews: typeof FetchNews | null;
  queue: LlmQueue;
  logger: Logger;
  activity: Activity;
  language: () => Language;
  now?: () => Date;
}

/** A card that was never researched, as it looks before its first run. */
export function blankResearch(): CompanyResearch {
  return {
    state: 'queued', startedAt: null, finishedAt: null, provider: null, language: null, website: '', websiteByPerson: false,
    about: '', news: [], newsFailed: false, redFlags: [], facts: [], sources: [], error: null,
  };
}

/** What `collect` reads for a card (spec 3.3; Arbeitsagentur pages are behind a captcha, so step 1 is skipped). */
export function collectInputOf(v: Vacancy): CollectInput {
  const aa = v.source === 'arbeitsagentur';
  const r = v.research;
  return {
    vacancyUrl: aa ? '' : v.url,
    partnerUrl: v.partnerUrl ?? '',
    company: v.company,
    websiteHint: r?.websiteByPerson ? r.website : '',
    skipVacancyPage: aa,
  };
}

const codeOf = (err: unknown): ErrorCode => (err instanceof AppError ? err.code : 'UNKNOWN');
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ''; } };

export class ResearchJob {
  private readonly waiting: string[] = [];
  private running: { id: string; ctrl: AbortController } | null = null;
  /** A run writes only while its generation is the card's latest (a stop or a new start makes it stale). */
  private readonly gen = new Map<string, number>();
  private idle: Promise<void> = Promise.resolve();
  private wake: (() => void) | null = null;
  private readonly now: () => Date;

  constructor(private readonly d: ResearchJobDeps) {
    this.now = d.now ?? (() => new Date());
  }

  /**
   * Puts the card in line (state `queued`). A card already waiting stays where it is; a card being researched right
   * now is stopped and starts again (a new website was typed).
   */
  enqueue(vacancyId: string): void {
    const v = this.d.store.require(vacancyId);
    if (v.status === 'hidden') throw new AppError('CONFLICT', 'a hidden card is not researched');
    if (this.waiting.includes(vacancyId)) return;
    const g = this.bump(vacancyId);
    if (this.running?.id === vacancyId) this.running.ctrl.abort();
    this.write(vacancyId, g, (x) => { x.research = { ...(x.research ?? blankResearch()), state: 'queued', error: null }; });
    this.waiting.push(vacancyId);
    this.pump();
  }

  /** Stops the card's research (waiting or running): state `failed` with LLM_CANCELLED, earlier results kept. */
  cancel(vacancyId: string): void {
    const at = this.waiting.indexOf(vacancyId);
    const isRunning = this.running?.id === vacancyId;
    if (at < 0 && !isRunning) return;
    if (at >= 0) this.waiting.splice(at, 1);
    const g = this.bump(vacancyId);
    if (isRunning) this.running?.ctrl.abort();
    this.fail(vacancyId, g, 'LLM_CANCELLED', { evenHidden: true });
  }

  /** A research is running or waiting (a restore or an update must wait for it). */
  busy(): boolean {
    return this.running !== null || this.waiting.length > 0;
  }

  /** Resolves when nothing runs and nothing waits (tests). */
  whenIdle(): Promise<void> {
    return this.idle;
  }

  private bump(id: string): number {
    const g = (this.gen.get(id) ?? 0) + 1;
    this.gen.set(id, g);
    return g;
  }

  private pump(): void {
    if (this.running || this.waiting.length === 0) return;
    if (!this.wake) this.idle = new Promise<void>((resolve) => { this.wake = resolve; });
    const id = this.waiting.shift() as string;
    const ctrl = new AbortController();
    this.running = { id, ctrl };
    void this.runOne(id, this.gen.get(id) ?? 0, ctrl.signal).finally(() => {
      this.running = null;
      if (this.waiting.length > 0) this.pump();
      else { const w = this.wake; this.wake = null; w?.(); }
    });
  }

  private async runOne(id: string, g: number, signal: AbortSignal): Promise<void> {
    const end = this.d.activity.begin('research');
    const startedAt = this.now().toISOString();
    try {
      const v = this.d.store.get(id);
      if (!v || v.status === 'hidden' || this.gen.get(id) !== g) return;
      this.write(id, g, (x) => { if (x.research) { x.research.state = 'running'; x.research.startedAt = startedAt; x.research.error = null; } });
      const input = collectInputOf(v);
      const c = await collect(input, 'full', { reader: this.d.reader, fetchNews: this.d.fetchNews, now: this.now }, signal);
      // Hidden, gone or restarted while the pages were read: no AI calls for it.
      if (!this.stillWanted(id, g)) return;
      const contact = await withNameFromPages(c.contact, c.pages, this.d, signal);
      if (!this.stillWanted(id, g)) return;
      const language = this.d.language();
      const { value, provider } = await this.d.queue.runTagged<ResearchOutput>(companyResearchTask(v.company, c, language), signal);
      const research = toResearch(value, c, { provider, language, startedAt, now: this.now().toISOString(), websiteByPerson: input.websiteHint !== '' });
      const written = this.write(id, g, (x) => {
        x.research = research;
        const merged = mergeContact(x.contact, contact, x.contactAuto);
        x.contact = merged.contact;
        if (merged.auto.length) x.contactAuto = merged.auto;
        else delete x.contactAuto;
      });
      // Hidden meanwhile: no results, but the card must not stay "researching" when it comes back. Shown and still
      // ours but not written: the write itself failed (logged) — that is no "stopped" (final review M4).
      let result = 'ok';
      if (!written) {
        const now = this.d.store.get(id);
        const stopped = !now || now.status === 'hidden' || this.gen.get(id) !== g;
        result = stopped ? 'dropped' : 'failed';
        this.fail(id, g, stopped ? 'LLM_CANCELLED' : 'UNKNOWN', { evenHidden: true });
      }
      this.d.logger.info('research.done', { result, host: hostOf(c.website), pages: c.pages.length });
    } catch (err) {
      const code = codeOf(err);
      if (this.gen.get(id) === g) this.fail(id, g, code, { evenHidden: true });
      this.d.logger.info('research.done', { result: 'failed', code });
    } finally {
      end();
    }
  }

  /**
   * The run may go on: it is still the card's latest and the card exists and is shown. A hidden card ends as stopped
   * (state only) so it is not "researching" when it comes back; a stale run or a gone card just ends.
   */
  private stillWanted(id: string, g: number): boolean {
    if (this.gen.get(id) !== g) return false;
    const v = this.d.store.get(id);
    if (!v) return false;
    if (v.status === 'hidden') { this.fail(id, g, 'LLM_CANCELLED', { evenHidden: true }); return false; }
    return true;
  }

  private fail(id: string, g: number, code: ErrorCode, o: { evenHidden: boolean }): void {
    this.write(id, g, (x) => {
      x.research = { ...(x.research ?? blankResearch()), state: 'failed', finishedAt: this.now().toISOString(), error: code };
    }, o);
  }

  /**
   * Changes the card only while this run is the latest one and the card still exists (and, unless `evenHidden`, is
   * not hidden: a hidden card gets no results). A failed write is logged, never thrown — the job keeps going.
   */
  private write(id: string, g: number, change: (v: Vacancy) => void, o: { evenHidden: boolean } = { evenHidden: false }): boolean {
    if (this.gen.get(id) !== g) return false;
    const v = this.d.store.get(id);
    if (!v || (!o.evenHidden && v.status === 'hidden')) return false;
    try {
      this.d.store.update(id, change);
      return true;
    } catch (err) {
      this.d.logger.warn('research.write_failed', { code: codeOf(err) });
      return false;
    }
  }
}
