import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DataPaths {
  root: string; settings: string; server: string; lock: string; logs: string; tmp: string;
  profile: string; profileFile: string; profileFiles: string;
  vacancies: string; vacanciesFile: string; vacancyTexts: string; searchState: string;
  applications: string; mailSecret: string;
}

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
    profile: path.join(root, 'profile'),
    profileFile: path.join(root, 'profile', 'profile.json'),
    profileFiles: path.join(root, 'profile', 'files'),
    vacancies: path.join(root, 'vacancies'),
    vacanciesFile: path.join(root, 'vacancies', 'vacancies.json'),
    vacancyTexts: path.join(root, 'vacancies', 'texts'),
    searchState: path.join(root, 'vacancies', 'search-state.json'),
    applications: path.join(root, 'applications'),
    mailSecret: path.join(root, 'mail-secret.bin'),
  };
}

export function ensureDataDirs(p: DataPaths): void {
  for (const dir of [p.root, p.logs, p.tmp, p.profile, p.profileFiles, p.vacancies, p.vacancyTexts, p.applications]) fs.mkdirSync(dir, { recursive: true });
}
