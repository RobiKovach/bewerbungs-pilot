import { readJson } from '../data/atomic.js';

/** `key`: this launch's key (see launch-key.ts); missing in files written before 0.8.3. */
export interface ServerInfo { port: number; pid: number; startedAt: string; key?: string }

export interface RunningInstance { port: number; key: string }

export function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// A second double-click on the shortcut must reuse the running server, not start another one.
export async function findRunningInstance(serverJsonFile: string): Promise<RunningInstance | null> {
  let info: ServerInfo | null;
  try { info = readJson<ServerInfo>(serverJsonFile); } catch { return null; }
  if (!info || typeof info.port !== 'number' || typeof info.pid !== 'number' || !isAlive(info.pid)) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { app?: string };
    // A server from before 0.8.3 wrote no key (key ''): the caller then opens plain /.
    return res.ok && body.app === 'bewerbungs-pilot' ? { port: info.port, key: typeof info.key === 'string' ? info.key : '' } : null;
  } catch {
    return null;
  }
}

/** The loser of the start-up race waits here for the winner's server.json, then opens the browser to it. */
export async function waitForRunningInstance(serverJsonFile: string, timeoutMs: number, intervalMs = 250): Promise<RunningInstance | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await findRunningInstance(serverJsonFile);
    if (found !== null) return found;
    if (Date.now() + intervalMs > deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
