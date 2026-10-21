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
}
