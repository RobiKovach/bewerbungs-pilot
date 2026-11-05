import fs from 'node:fs';

export type Warn = (event: string, data: Record<string, unknown>) => void;

/**
 * Removes a temporary file or folder. Windows may hold a file just after it was closed, so this retries; if it still
 * fails the caller's work is not undone, but `warn` hears about it with the error code only: never a path or any text.
 */
export async function removeTemp(target: string, event: string, warn?: Warn): Promise<void> {
  try {
    await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) {
    warn?.(event, { code: (err as NodeJS.ErrnoException).code ?? 'UNKNOWN' });
  }
}
