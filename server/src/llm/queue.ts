import { AppError } from '../errors.js';
import type { LlmProvider, LlmTask } from './types.js';

// One Claude process at a time, first come first served.
export class LlmQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private running = false;
  private waiting = 0;

  constructor(private readonly provider: LlmProvider) {}

  status(): { running: boolean; queued: number } {
    return { running: this.running, queued: this.waiting };
  }

  run<T>(task: LlmTask, signal: AbortSignal): Promise<T> {
    this.waiting++;
    const job = this.tail.then(async () => {
      this.waiting--;
      if (signal.aborted) throw new AppError('LLM_CANCELLED', 'cancelled while waiting in the queue');
      this.running = true;
      try {
        return await this.provider.run<T>(task, signal);
      } finally {
        this.running = false;
      }
    });
    this.tail = job.catch(() => undefined);
    return job;
  }
}
