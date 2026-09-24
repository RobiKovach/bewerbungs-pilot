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
    const job = this.tail.then(async () => {
      this.waiting--;
      if (ctrl.signal.aborted) throw new AppError('LLM_CANCELLED', 'cancelled while waiting in the queue');
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
    job.then(done, done);
    this.tail = job.catch(() => undefined);
    return job;
  }
}
