import { AppError } from '../errors.js';
import type { LlmProvider, LlmTask } from './types.js';

// One Claude process at a time, first come first served.
export class LlmQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private running = false;
  private waiting = 0;
  /** One controller per task that is queued or running; abortAll() fires them all. */
  private readonly active = new Set<AbortController>();

  constructor(private readonly provider: LlmProvider) {}

  status(): { running: boolean; queued: number } {
    return { running: this.running, queued: this.waiting };
  }

  /** Used on shutdown: kills the running Claude process and makes every queued task fail with LLM_CANCELLED. */
  abortAll(): void {
    for (const ctrl of this.active) ctrl.abort();
  }

  run<T>(task: LlmTask, signal: AbortSignal): Promise<T> {
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
      this.running = true;
      try {
        return await this.provider.run<T>(task, ctrl.signal);
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
