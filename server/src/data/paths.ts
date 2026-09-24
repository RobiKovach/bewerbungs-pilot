import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DataPaths { root: string; settings: string; server: string; lock: string; logs: string; tmp: string }

export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BP_DATA_DIR) return path.resolve(env.BP_DATA_DIR);
  const base = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'BewerbungsPilot');
}

export function dataPaths(root: string): DataPaths {
  return {
    root,
    settings: path.join(root, 'settings.json'),
    server: path.join(root, 'server.json'),
    lock: path.join(root, 'server.lock'),
    logs: path.join(root, 'logs'),
    tmp: path.join(root, 'tmp'),
  };
}

export function ensureDataDirs(p: DataPaths): void {
  for (const dir of [p.root, p.logs, p.tmp]) fs.mkdirSync(dir, { recursive: true });
}
