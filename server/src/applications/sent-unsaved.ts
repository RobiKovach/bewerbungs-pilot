import { CorruptJsonError, readJson, writeJsonAtomic } from '../data/atomic.js';

type Warn = (event: string, data: Record<string, unknown>) => void;

/** Emails that went out but could not be recorded on their package: never sent again, also after a restart. */
export class SentUnsavedLog {
  private keys = new Set<string>();

  constructor(private readonly file: string | null, private readonly warn: Warn = () => {}) {}

  /** A missing or broken file means an empty log (a broken one is warned about, without its content). */
  load(): void {
    this.keys.clear();
    if (!this.file) return;
    try {
      const raw = readJson<unknown>(this.file);
      if (raw === null) return;
      const keys = (raw as { keys?: unknown } | null)?.keys;
      if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string')) {
        this.warn('sent_unsaved_unreadable', {});
        return;
      }
      for (const k of keys) this.keys.add(k as string);
    } catch (err) {
      if (!(err instanceof CorruptJsonError)) throw err;
      this.warn('sent_unsaved_unreadable', {});
    }
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  /** Memory first (so the block holds even if the disk fails), then an atomic write; a failed write only warns. */
  add(key: string): void {
    this.keys.add(key);
    if (!this.file) return;
    try {
      writeJsonAtomic(this.file, { keys: [...this.keys] });
    } catch (err) {
      this.warn('sent_unsaved_write_failed', { code: (err as NodeJS.ErrnoException).code ?? 'UNKNOWN' });
    }
  }
}
