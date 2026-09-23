import { readJson } from '../data/atomic.js';

export interface ServerInfo { port: number; pid: number; startedAt: string }

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// A second double-click on the shortcut must reuse the running server, not start another one.
export async function findRunningInstance(serverJsonFile: string): Promise<number | null> {
  let info: ServerInfo | null;
  try { info = readJson<ServerInfo>(serverJsonFile); } catch { return null; }
  if (!info || typeof info.port !== 'number' || typeof info.pid !== 'number' || !isAlive(info.pid)) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { app?: string };
    return res.ok && body.app === 'bewerbungs-pilot' ? info.port : null;
  } catch {
    return null;
  }
}
