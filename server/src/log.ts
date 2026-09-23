import fs from 'node:fs';
import path from 'node:path';

type Level = 'info' | 'warn' | 'error';
type LogFn = (event: string, data?: Record<string, unknown>) => void;
export interface Logger { info: LogFn; warn: LogFn; error: LogFn }

export const nullLogger: Logger = { info() {}, warn() {}, error() {} };

export function createFileLogger(dir: string, opts: { maxBytes?: number; maxFiles?: number } = {}): Logger {
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const maxFiles = opts.maxFiles ?? 5;
  const file = (i: number) => path.join(dir, i === 0 ? 'app.log' : `app.${i}.log`);

  function rotateIfNeeded(): void {
    let size: number;
    try { size = fs.statSync(file(0)).size; } catch { return; }
    if (size < maxBytes) return;
    fs.rmSync(file(maxFiles - 1), { force: true });
    for (let i = maxFiles - 2; i >= 0; i--) {
      if (fs.existsSync(file(i))) fs.renameSync(file(i), file(i + 1));
    }
  }

  function write(level: Level, event: string, data: Record<string, unknown> = {}): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
      rotateIfNeeded();
      fs.appendFileSync(file(0), JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }) + '\n', 'utf8');
    } catch {
      // Logging must never crash the app.
    }
  }

  return {
    info: (event, data) => write('info', event, data),
    warn: (event, data) => write('warn', event, data),
    error: (event, data) => write('error', event, data),
  };
}
