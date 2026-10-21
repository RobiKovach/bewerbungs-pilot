import { AppError } from '../errors.js';

/**
 * Work in flight that is not a job with its own state (an email being sent, a restore): whatever must not run at the
 * same time asks `active()`. `begin` returns the matching `end`; calling it twice is harmless.
 */
export class Activity {
  private readonly open = new Map<number, string>();
  private next = 0;

  begin(name: string): () => void {
    const id = this.next++;
    this.open.set(id, name);
    return () => { this.open.delete(id); };
  }

  active(): string[] {
    return [...this.open.values()];
  }

  /** Sending, a search, a package job or a mailbox change must not start while a restore swaps the data (spec 3.1). */
  refuseDuringRestore(): void {
    if (this.active().includes('restore')) throw new AppError('CONFLICT', 'a restore is running', 'restoreRunning');
  }
}
