import type { Language } from '../data/settings.js';

export type JsonSchema = Record<string, unknown>;

export interface LlmTask {
  prompt: string;
  schema: JsonSchema;
  replyLanguage: Language;
  allowWebSearch?: boolean;
  /**
   * Absolute paths of files Claude should read. They are COPIED into the per-run folder as input/file-1.<ext>, ...
   * and the prompt gets that list appended; Claude is never given access to the folders the originals live in.
   * Prompts should refer to "the input files", not to the original names.
   */
  files?: string[];
}

export interface Availability {
  ok: boolean;
  reason?: 'not-installed' | 'not-logged-in' | 'error';
  detail?: string;
}

export interface LlmProvider {
  readonly id: 'claude-code' | 'anthropic-api';
  checkAvailable(opts?: { refresh?: boolean }): Promise<Availability>;
  run<T>(task: LlmTask, signal: AbortSignal): Promise<T>;
  /** Opens the provider's own sign-in window, if it has one. */
  openLogin?(): void;
}
