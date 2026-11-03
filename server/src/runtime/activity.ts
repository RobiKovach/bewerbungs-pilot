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

  /**
   * Sending, a search, a package job or a mailbox change must not start while a restore swaps the data (spec 0.9.0, 3.1)
   * — nor while an update is being installed (0.11.0): the data is copied and the program replaced.
   */
  refuseDuringRestore(): void {
    const now = this.active();
    if (now.includes('restore')) throw new AppError('CONFLICT', 'a restore is running', 'restoreRunning');
    this.refuseDuringUpdate();
  }

  /** An update is downloading / installing (0.11.0): nothing else may start, and a second update neither. */
  refuseDuringUpdate(): void {
    if (this.active().includes('update')) throw new AppError('CONFLICT', 'an update is running', 'updateRunning');
  }
}
