import fs from 'node:fs';
import path from 'node:path';

/**
 * Removes a file or a whole folder; a missing one is fine. Use this instead of fs.rmSync: on Windows Node's native
 * rmSync (seen on 24.21) ends the whole process — no exception to catch — when something under a path with non-ASCII
 * letters ("C:\Users\Ольга") is in use. Here that is an ordinary error (EBUSY/EPERM) after the retries.
 */
export function removeSync(target: string, opts: { maxRetries?: number; retryDelay?: number } = {}): void {
  const { maxRetries = 0, retryDelay = 100 } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      removeOnce(target);
      return;
    } catch (err) {
      const busy = ['EBUSY', 'EPERM', 'ENOTEMPTY', 'EMFILE', 'ENFILE'].includes((err as NodeJS.ErrnoException).code ?? '');
      if (!busy || attempt >= maxRetries) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelay);
    }
  }
}

function removeOnce(target: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(target);
  } catch (err) {
    if (isGone(err)) return;
    throw err;
  }
  try {
    // lstat: a link or junction is removed itself, never what it points to.
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(target)) removeOnce(path.join(target, name));
      fs.rmdirSync(target);
    } else unlink(target);
  } catch (err) {
    if (!isGone(err)) throw err;
  }
}

function unlink(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
    // Windows refuses to delete a read-only file.
    fs.chmodSync(file, 0o666);
    fs.unlinkSync(file);
  }
}

const isGone = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT';
