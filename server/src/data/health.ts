import fs from 'node:fs';
import path from 'node:path';
import type { DataProblem } from '@bp/shared';
import { APPLICATION_ID, PACKAGE_SCHEMA_VERSION } from '../applications/schema.js';
import { SET_ASIDE } from '../backup/format.js';
import { PROFILE_SCHEMA_VERSION } from '../profile/schema.js';
import { VACANCIES_SCHEMA_VERSION } from '../vacancies/schema.js';
import { readJson, writeJsonAtomic } from './atomic.js';
import type { DataPaths } from './paths.js';

function names(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
}
const packageDirs = (p: DataPaths) => names(p.applications).filter((n) => APPLICATION_ID.test(n)).map((n) => path.join(p.applications, n));

/**
 * True when the profile, the vacancies or a package was written by a newer app (the person went back to an older one).
 * Asked before any store reads: the stores would put such files aside and the app would look empty. applications.json
 * does not count — it is only a list, always rebuilt from the packages; settings read any version.
 */
export function dataIsNewer(p: DataPaths): boolean {
  const newer = (file: string, current: number): boolean => {
    try {
      const v = readJson<{ schemaVersion?: unknown }>(file)?.schemaVersion;
      return typeof v === 'number' && Number.isInteger(v) && v > current;
    } catch {
      return false; // unreadable or not JSON: the store's own rules apply
    }
  };
  return newer(p.profileFile, PROFILE_SCHEMA_VERSION) || newer(p.vacanciesFile, VACANCIES_SCHEMA_VERSION)
    || packageDirs(p).some((dir) => newer(path.join(dir, 'package.json'), PACKAGE_SCHEMA_VERSION));
}

const noticeFile = (p: DataPaths) => path.join(p.root, 'data-notice.json');

/** Data the stores had to put aside and whose note the person has not closed yet. */
export function dataProblems(p: DataPaths): DataProblem[] {
  let dismissedAt = 0;
  try {
    const raw = readJson<{ dismissedAt?: unknown }>(noticeFile(p));
    if (typeof raw?.dismissedAt === 'number') dismissedAt = raw.dismissedAt;
  } catch { /* an unreadable note file: show the problems again */ }
  const fresh = (dir: string) => names(dir).some((f) => SET_ASIDE.test(f) && Number(/-(\d+)\.json$/.exec(f)?.[1] ?? 0) > dismissedAt);
  const out: DataProblem[] = [];
  if (fresh(p.profile)) out.push('profile');
  if (fresh(p.vacancies)) out.push('vacancies');
  // Only inside the packages: a broken applications.json is rebuilt from them, nothing is lost.
  if (packageDirs(p).some(fresh)) out.push('applications');
  return out;
}

export function dismissDataProblems(p: DataPaths, now = Date.now()): void {
  writeJsonAtomic(noticeFile(p), { dismissedAt: now });
}
