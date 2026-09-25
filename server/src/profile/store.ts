import fs from 'node:fs';
import path from 'node:path';
import type { Profile } from '@bp/shared';
import { CorruptJsonError, readJson, writeJsonAtomic } from '../data/atomic.js';
import { migrate, MigrationError } from '../data/migrate.js';
import { AppError } from '../errors.js';
import { emptyProfile, PROFILE_MIGRATIONS, PROFILE_SCHEMA_VERSION, validateProfile } from './schema.js';

type Warn = (event: string, data: Record<string, unknown>) => void;

export class ProfileStore {
  private current: Profile = emptyProfile();
  /** Schema version of the file on disk when it is older than this app's; it gets a copy before the first write. */
  private olderVersionOnDisk: number | null = null;

  constructor(private readonly file: string, private readonly warn: Warn = () => {}) {}

  /** A broken or unknown file is never deleted: it is renamed next to profile.json and the app starts empty. */
  load(): Profile {
    this.olderVersionOnDisk = null;
    let raw: unknown;
    try {
      raw = readJson<unknown>(this.file);
    } catch (err) {
      if (!(err instanceof CorruptJsonError)) throw err;
      this.setAside('corrupt', String(err.cause));
      return this.reset();
    }
    if (raw === null) return this.reset();
    try {
      const doc = migrate(raw, PROFILE_SCHEMA_VERSION, PROFILE_MIGRATIONS);
      const problem = validateProfile(doc);
      if (problem) throw new MigrationError(problem);
      this.current = doc as unknown as Profile;
      const start = (raw as { schemaVersion: number }).schemaVersion;
      if (start < PROFILE_SCHEMA_VERSION) this.olderVersionOnDisk = start;
    } catch (err) {
      if (!(err instanceof MigrationError)) throw err;
      this.setAside('invalid', err.message);
      return this.reset();
    }
    return this.get();
  }

  get(): Profile {
    return structuredClone(this.current);
  }

  /** Applies `change` to a copy, validates and writes it; memory changes only after the file did. */
  update(change: (draft: Profile) => void): Profile {
    const next = structuredClone(this.current);
    change(next);
    const problem = validateProfile(next);
    if (problem) throw new AppError('BAD_REQUEST', `profile would become invalid: ${problem}`);
    try {
      if (this.olderVersionOnDisk !== null) {
        this.keepOlderVersion(this.olderVersionOnDisk);
        this.olderVersionOnDisk = null;
      }
      writeJsonAtomic(this.file, next);
    } catch (err) {
      throw new AppError('DATA_WRITE_FAILED', String(err));
    }
    this.current = next;
    return this.get();
  }

  private reset(): Profile {
    this.current = emptyProfile();
    return this.get();
  }

  /**
   * A copy of the file as the older app version wrote it ("profile.v1-<time>.json" next to it), made once before it is
   * first written in the new format, so going back to the older version stays possible. Never overwrites a backup.
   */
  private keepOlderVersion(version: number): void {
    const stamp = Date.now();
    for (let n = 0; ; n++) {
      const backup = path.join(path.dirname(this.file), `profile.v${version}-${stamp}${n ? `-${n}` : ''}.json`);
      try {
        fs.copyFileSync(this.file, backup, fs.constants.COPYFILE_EXCL);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') continue;
        if (code === 'ENOENT') return; // the file was removed meanwhile: nothing left to keep
        throw err;
      }
      this.warn('profile_version_backup', { backup, version });
      return;
    }
  }

  private setAside(kind: 'corrupt' | 'invalid', reason: string): void {
    const backup = path.join(path.dirname(this.file), `profile.${kind}-${Date.now()}.json`);
    fs.renameSync(this.file, backup);
    this.warn(`profile_${kind}`, { backup, reason: reason.slice(0, 500) });
  }
}
