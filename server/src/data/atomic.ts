import crypto from 'node:crypto';
import fs from 'node:fs';

export class CorruptJsonError extends Error {
  constructor(public readonly file: string, cause: unknown) {
    super(`Corrupt JSON: ${file}`, { cause });
    this.name = 'CorruptJsonError';
  }
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

// Temp file + rename, so a power cut never leaves a half-written file. Windows can briefly lock
// the target (antivirus, indexer) - retry a few times before giving up.
export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= 4 || !RETRYABLE.has(code)) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

export function readJson<T>(file: string): T | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new CorruptJsonError(file, err);
  }
}
