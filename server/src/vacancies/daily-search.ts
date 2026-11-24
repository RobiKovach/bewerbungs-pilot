import { CorruptJsonError, readJson, writeJsonAtomic } from '../data/atomic.js';
import type { Logger } from '../log.js';
import type { Activity } from '../runtime/activity.js';
import type { SearchJob } from './search-job.js';

const FIRST_CHECK_MS = 5 * 60_000;
const CHECK_EVERY_MS = 3600_000;
/** A little less than a day, so a PC switched on at the same time every morning searches every morning. */
export const DAILY_EVERY_MS = 20 * 3600_000;
/** Scoring costs the person's AI allowance: an automatic search takes fewer offers than one by hand. */
export const DAILY_MAX_NEW = 20;

export interface DailySearchDeps {
  job: SearchJob;
  activity: Activity;
  /** `<data root>/daily-search.json` { at }: restarts never mean more than one automatic search a day. */
  stateFile: string;
  /** Switched on, data readable, setup and job wishes complete, an AI helper chosen. */
  ready: () => boolean;
  logger: Logger;
  now?: () => number;
}

/**
 * Searches once a day without anyone asking (0.14.0), only while the app is open and only when switched on. A search by
 * hand counts as today's. Whatever is in the way (a restore, an update, a running search) just means an hour later; a
 * search that was started and failed is not repeated before the next day.
 */
export class DailySearch {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private readonly now: () => number;

  constructor(private readonly d: DailySearchDeps) {
    this.now = d.now ?? Date.now;
  }

  start(): void {
    this.stopped = false;
    this.plan(FIRST_CHECK_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private plan(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => { this.run(); this.plan(CHECK_EVERY_MS); }, ms);
    this.timer.unref();
  }

  /** True when a search was started. */
  run(): boolean {
    try {
      if (!this.d.ready()) return false;
      const state = this.d.job.state();
      const busy = this.d.activity.active();
      if (state.state === 'running' || busy.includes('restore') || busy.includes('update')) return false;
      const now = this.now();
      const recent = (t: number) => t <= now && now - t < DAILY_EVERY_MS;
      if (recent(this.lastAt()) || recent(Date.parse(state.startedAt ?? ''))) return false;
      // Written before the start: when it cannot be remembered, it must not run every hour.
      writeJsonAtomic(this.d.stateFile, { at: now });
      this.d.job.start({ maxNew: DAILY_MAX_NEW, automatic: true });
      return true;
    } catch (err) {
      this.d.logger.warn('daily_search_failed', { message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  private lastAt(): number {
    try {
      const raw = readJson<{ at?: unknown }>(this.d.stateFile);
      return typeof raw?.at === 'number' ? raw.at : NaN;
    } catch (err) {
      if (err instanceof CorruptJsonError) return NaN;
      throw err;
    }
  }
}
