import fs from 'node:fs';
import { readJson } from '../data/atomic.js';
import type { Logger } from '../log.js';
import { isAlive, type ServerInfo } from './instance.js';

export interface InstanceLock { release(): void }

function readLockPid(file: string): number | null {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Exclusive "one server per data folder" lock, held for the whole process lifetime. Closes the double-click race:
 * two launches that both found no running server.json can't both start a server. A lock whose recorded process is
 * gone (crash, power cut) is taken over. Returns null when another live process holds it.
 */
export function acquireInstanceLock(file: string, pid: number = process.pid): InstanceLock | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;
    try {
      fd = fs.openSync(file, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const owner = readLockPid(file);
      if (owner !== null && isAlive(owner)) return null;
      // Stale: re-check right before removing so we don't delete a lock someone else just took over.
      if (readLockPid(file) === owner) fs.rmSync(file, { force: true });
      continue;
    }
    fs.writeSync(fd, String(pid));
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        try { fs.closeSync(fd); } catch { /* already closed */ }
        if (readLockPid(file) === pid) fs.rmSync(file, { force: true });
      },
    };
  }
  return null;
}

/** Deletes server.json only if this process wrote it — a newer instance may already have replaced it. */
export function removeServerInfoIfOwn(file: string, pid: number = process.pid): void {
  let info: ServerInfo | null;
  try { info = readJson<ServerInfo>(file); } catch { return; }
  if (info?.pid === pid) fs.rmSync(file, { force: true });
}

export interface ShutdownDeps {
  /** Kills the running Claude process and drops queued work, so close() isn't held up by a 3-minute job. */
  abortAll: () => void;
  close: () => Promise<void>;
  releaseLock: () => void;
  serverFile: string;
  /** Upper bound for close(); an open request must not keep the old process alive during an update. */
  closeTimeoutMs: number;
  logger: Logger;
  exit: (code: number) => void;
}

export function createShutdown(deps: ShutdownDeps): () => Promise<void> {
  let running: Promise<void> | null = null;
  return () => {
    running ??= (async () => {
      deps.logger.info('shutdown', {});
      deps.abortAll();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), deps.closeTimeoutMs); });
      const result = await Promise.race([deps.close().then(() => 'closed' as const, () => 'closed' as const), timeout]);
      clearTimeout(timer);
      if (result === 'timeout') deps.logger.warn('shutdown_close_timeout', { ms: deps.closeTimeoutMs });
      removeServerInfoIfOwn(deps.serverFile);
      deps.releaseLock();
      deps.exit(0);
    })();
    return running;
  };
}
