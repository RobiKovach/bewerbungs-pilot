import fs from 'node:fs';
import path from 'node:path';
import type { Vacancy } from '@bp/shared';
import { CorruptJsonError, readJson, writeJsonAtomic } from '../data/atomic.js';
import { migrate, MigrationError } from '../data/migrate.js';
import { AppError } from '../errors.js';
import { VACANCIES_SCHEMA_VERSION, VACANCY_ID, VACANCY_LIMITS, validateVacancies } from './schema.js';

type Warn = (event: string, data: Record<string, unknown>) => void;

/**
 * validateVacancies()/validateOutput() end their message with a JSON echo of the whole invalid document — for a
 * vacancies file that includes every card's title, company and contact. That is fine for a developer reading the
 * error directly, but never for a log: this drops the echo and keeps only the ajv reason (e.g. a field path and
 * what rule it broke), which is already a useful, non-personal hint.
 */
function forLog(problem: string): string {
  return problem.replace(/ \(got .*\)$/s, '');
}

/**
 * All cards in one small JSON file; full offer texts in texts/<id>.txt so that a click on "Interesting" does not rewrite
 * megabytes. Same safety rules as ProfileStore: atomic writes, memory changes only after the file did, a broken or
 * unknown file is put aside (never deleted) and the app starts empty.
 */
export class VacancyStore {
  private items: Vacancy[] = [];

  constructor(private readonly paths: { file: string; textsDir: string }, private readonly warn: Warn = () => {}) {}

  load(): Vacancy[] {
    let raw: unknown;
    try {
      raw = readJson<unknown>(this.paths.file);
    } catch (err) {
      if (!(err instanceof CorruptJsonError)) throw err;
      this.setAside('corrupt', String(err.cause));
      return this.reset();
    }
    if (raw === null) return this.reset();
    try {
      const doc = migrate(raw, VACANCIES_SCHEMA_VERSION, {});
      const problem = validateVacancies(doc);
      if (problem) throw new MigrationError(problem);
      this.items = (doc as unknown as { vacancies: Vacancy[] }).vacancies;
    } catch (err) {
      if (!(err instanceof MigrationError)) throw err;
      this.setAside('invalid', forLog(err.message));
      return this.reset();
    }
    return this.list();
  }

  list(): Vacancy[] {
    return structuredClone(this.items);
  }

  get(id: string): Vacancy | undefined {
    const v = this.items.find((x) => x.id === id);
    return v ? structuredClone(v) : undefined;
  }

  require(id: string): Vacancy {
    const v = this.get(id);
    if (!v) throw new AppError('VACANCY_NOT_FOUND', id);
    return v;
  }

  add(v: Vacancy, text: string | null): Vacancy {
    const card = structuredClone(v);
    if (text !== null) {
      this.writeTextFile(card.id, text);
      card.hasText = true;
    }
    try {
      this.commit([...this.items, card]);
    } catch (err) {
      // The text file was written but the card itself never made it into vacancies.json — do not leave it orphaned.
      if (text !== null) fs.rmSync(this.textFile(card.id), { force: true });
      throw err;
    }
    return structuredClone(card);
  }

  update(id: string, change: (v: Vacancy) => void): Vacancy {
    if (!this.items.some((x) => x.id === id)) throw new AppError('VACANCY_NOT_FOUND', id);
    return this.updateMany([id], change)[0];
  }

  updateMany(ids: readonly string[], change: (v: Vacancy) => void): Vacancy[] {
    const wanted = new Set(ids);
    const changed: Vacancy[] = [];
    const next = this.items.map((v) => {
      if (!wanted.has(v.id)) return v;
      const copy = structuredClone(v);
      change(copy);
      changed.push(copy);
      return copy;
    });
    if (changed.length > 0) this.commit(next);
    return structuredClone(changed);
  }

  readText(id: string): string | null {
    if (!VACANCY_ID.test(id)) return null;
    try {
      return fs.readFileSync(this.textFile(id), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  writeText(id: string, text: string): void {
    this.require(id);
    this.writeTextFile(id, text);
    this.update(id, (v) => { v.hasText = true; });
  }

  compactHidden(): number {
    const ids = this.items.filter((v) => v.status === 'hidden' && v.source === 'arbeitsagentur' && (v.hasText || v.score !== null)).map((v) => v.id);
    if (ids.length === 0) return 0;
    this.updateMany(ids, (v) => {
      v.locations = []; v.remote = 'unknown'; v.employment = []; v.salaryText = ''; v.publishedAt = '';
      v.contact = null; v.hasText = false; v.score = null; v.scoreState = 'notScored';
    });
    for (const id of ids) fs.rmSync(this.textFile(id), { force: true });
    return ids.length;
  }

  private textFile(id: string): string {
    return path.join(this.paths.textsDir, `${id}.txt`);
  }

  private writeTextFile(id: string, text: string): void {
    if (!VACANCY_ID.test(id)) throw new AppError('BAD_REQUEST', `unsafe vacancy id ${id}`);
    try {
      fs.mkdirSync(this.paths.textsDir, { recursive: true });
      fs.writeFileSync(this.textFile(id), text.slice(0, VACANCY_LIMITS.text), 'utf8');
    } catch (err) {
      throw new AppError('DATA_WRITE_FAILED', String(err));
    }
  }

  private commit(next: Vacancy[]): void {
    const doc = { schemaVersion: VACANCIES_SCHEMA_VERSION, vacancies: next };
    const problem = validateVacancies(doc);
    if (problem) throw new AppError('BAD_REQUEST', `vacancies would become invalid: ${forLog(problem).slice(0, 500)}`);
    try {
      fs.mkdirSync(path.dirname(this.paths.file), { recursive: true });
      writeJsonAtomic(this.paths.file, doc);
    } catch (err) {
      throw new AppError('DATA_WRITE_FAILED', String(err));
    }
    this.items = next;
  }

  private reset(): Vacancy[] {
    this.items = [];
    return [];
  }

  private setAside(kind: 'corrupt' | 'invalid', reason: string): void {
    const backup = path.join(path.dirname(this.paths.file), `vacancies.${kind}-${Date.now()}.json`);
    fs.renameSync(this.paths.file, backup);
    this.warn(`vacancies_${kind}`, { backup, reason: reason.slice(0, 500) });
  }
}
