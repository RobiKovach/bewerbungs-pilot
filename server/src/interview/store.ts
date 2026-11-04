import fs from 'node:fs';
import path from 'node:path';
import type { InterviewPrep } from '@bp/shared';
import { APPLICATION_ID, forLog } from '../applications/schema.js';
import { CorruptJsonError, readJson, writeJsonAtomic } from '../data/atomic.js';
import { AppError } from '../errors.js';
import { validatePrep } from './schema.js';

type Warn = (event: string, data: Record<string, unknown>) => void;
const FILE = 'interview-prep.json';

/**
 * interview-prep.json in the folder of an application. It lives beside the package, which is frozen once sent, and
 * has no copy in memory: after a restored backup the next read sees the restored file. A broken file is put aside
 * (never deleted) and logged without its content.
 */
export class InterviewPrepStore {
  constructor(private readonly dir: string, private readonly warn: Warn = () => {}) {}

  read(id: string): InterviewPrep | null {
    const file = this.file(id);
    let raw: unknown;
    try {
      raw = readJson<unknown>(file);
    } catch (err) {
      if (!(err instanceof CorruptJsonError)) throw err;
      this.setAside(id, 'corrupt', 'not JSON');
      return null;
    }
    // readJson answers null both for a missing file and for a file holding `null`.
    if (raw === null) {
      if (fs.existsSync(file)) this.setAside(id, 'invalid', 'not a preparation');
      return null;
    }
    const problem = validatePrep(raw) ?? ((raw as InterviewPrep).applicationId === id ? null : 'belongs to another application');
    if (problem) {
      this.setAside(id, 'invalid', forLog(problem));
      return null;
    }
    return raw as InterviewPrep;
  }

  /** The folder must exist already: a late write must not bring a removed application's folder back. */
  write(prep: InterviewPrep): void {
    const file = this.file(prep.applicationId);
    const problem = validatePrep(prep);
    if (problem) throw new AppError('BAD_REQUEST', `preparation would become invalid: ${forLog(problem)}`);
    try {
      writeJsonAtomic(file, prep);
    } catch (err) {
      throw new AppError('DATA_WRITE_FAILED', String(err));
    }
  }

  private file(id: string): string {
    if (!APPLICATION_ID.test(id)) throw new AppError('BAD_REQUEST', 'unsafe application id');
    return path.join(this.dir, id, FILE);
  }

  private setAside(id: string, kind: 'corrupt' | 'invalid', reason: string): void {
    const file = this.file(id);
    fs.renameSync(file, path.join(path.dirname(file), `interview-prep.${kind}-${Date.now()}.json`));
    this.warn(`interview_prep_${kind}`, { id, reason });
  }
}
