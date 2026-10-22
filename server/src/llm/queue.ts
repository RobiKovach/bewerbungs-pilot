import { AppError } from '../errors.js';
import type { LlmProvider, LlmTask, ProviderId } from './types.js';

/** Builds the task for the provider whose turn it is. */
export type TaskFor = (provider: LlmProvider) => LlmTask | Promise<LlmTask>;

// One AI process at a time, first come first served. The provider is resolved when a task's turn
// starts (not when it is queued), so switching the AI helper affects every request that has not started yet.
export class LlmQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private running = false;
  private waiting = 0;
  /** One controller per task that is queued or running; abortAll() fires them all. */
  private readonly active = new Set<AbortController>();

  private readonly resolve: () => LlmProvider;

  constructor(provider: LlmProvider | (() => LlmProvider)) {
    this.resolve = typeof provider === 'function' ? provider : () => provider;
  }

  /** The provider the NEXT request would use (throws LLM_NOT_CHOSEN). */
  current(): LlmProvider {
    return this.resolve();
  }

  status(): { running: boolean; queued: number } {
    return { running: this.running, queued: this.waiting };
  }

  /** Used on shutdown: kills the running Claude process and makes every queued task fail with LLM_CANCELLED. */
  abortAll(): void {
    for (const ctrl of this.active) ctrl.abort();
  }

  /**
   * `task` may be a function of the provider that actually runs it (its turn decides, see above): a CV is a file for
   * Claude but text for ChatGPT, and the helper may change while the task waits.
   */
  run<T>(task: LlmTask | TaskFor, signal: AbortSignal): Promise<T> {
    return this.runTagged<T>(task, signal).then((r) => r.value);
  }

  /** Like run(), but also says which provider actually did the work. */
  runTagged<T>(task: LlmTask | TaskFor, signal: AbortSignal): Promise<{ value: T; provider: ProviderId }> {
    const ctrl = new AbortController();
    const forward = () => ctrl.abort();
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', forward, { once: true });
    this.active.add(ctrl);
    this.waiting++;
    let started = false;
    const turn = this.tail.then(async () => {
      this.waiting--;
      started = true;
      if (ctrl.signal.aborted) throw new AppError('LLM_CANCELLED', 'cancelled while waiting in the queue', 'cancelledByUser');
      // A throw here (LLM_NOT_CHOSEN) rejects this turn only; the queue keeps going.
      const provider = this.resolve();
      this.running = true;
      try {
        const t = typeof task === 'function' ? await task(provider) : task;
        return { value: await provider.run<T>(t, ctrl.signal), provider: provider.id };
      } finally {
        this.running = false;
      }
    });
    const done = () => {
      this.active.delete(ctrl);
      signal.removeEventListener('abort', forward);
    };
    turn.then(done, done);
    this.tail = turn.catch(() => undefined);
    // A task can wait behind others for a long time (a search's batches, a manual paste, "score again").
    // If its own signal aborts while it is still waiting, reject at once instead of only once its turn
    // comes — otherwise Stop (or a request disconnect) can hang for as long as the run ahead of it takes.
    // Once the task has actually started (`started` true), this stays pending forever and `turn` alone
    // decides the outcome, so a running task is still cancelled the existing way, through `ctrl.signal`.
    const waitingAbort = new Promise<never>((_resolve, reject) => {
      const rejectIfStillWaiting = () => {
        if (!started) reject(new AppError('LLM_CANCELLED', 'cancelled while waiting in the queue', 'cancelledByUser'));
      };
      if (ctrl.signal.aborted) rejectIfStillWaiting();
      else ctrl.signal.addEventListener('abort', rejectIfStillWaiting, { once: true });
    });
    return Promise.race([turn, waitingAbort]);
  }
}
