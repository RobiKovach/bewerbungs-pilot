import fs from 'node:fs';
import path from 'node:path';
import type { ApplicationPackage, ApplicationSummary } from '@bp/shared';
import { CorruptJsonError, readJson, writeJsonAtomic } from '../data/atomic.js';
import { AppError } from '../errors.js';
import { migrate, MigrationError } from '../data/migrate.js';
import { FROZEN } from './status.js';
import { APPLICATION_ID, APPLICATIONS_SCHEMA_VERSION, forLog, LIST_MIGRATIONS, PACKAGE_MIGRATIONS, PACKAGE_SCHEMA_VERSION, validateList, validatePackage } from './schema.js';

type Warn = (event: string, data: Record<string, unknown>) => void;
export interface PhotoFile { data: Buffer; ext: '.jpg' | '.png' }

const summaryOf = (p: ApplicationPackage): ApplicationSummary => ({
  id: p.id, vacancyId: p.vacancyId, company: p.vacancy.company, title: p.vacancy.title, language: p.language, status: p.status,
  createdAt: p.createdAt, updatedAt: p.updatedAt, approvedAt: p.approvedAt, writtenBy: p.writtenBy,
});

/**
 * One folder per package (package.json, vacancy.txt, photo.*) plus applications.json as the list. Same safety rules
 * as the other stores: atomic writes, memory changes only after the files did, broken files are put aside (never
 * deleted) and logged without their content. applications.json can always be rebuilt from the folders.
 */
export class ApplicationStore {
  private packages = new Map<string, ApplicationPackage>();

  constructor(private readonly dir: string, private readonly warn: Warn = () => {}) {}

  load(): ApplicationSummary[] {
    fs.mkdirSync(this.dir, { recursive: true });
    this.packages.clear();
    const listFile = this.listFile();
    let ids: string[] | null = null;
    try {
      const raw = readJson<unknown>(listFile);
      if (raw !== null) {
        // Only the ids are used (the summaries are rebuilt from the packages), but a list that does not migrate
        // or validate is still put aside like any broken file.
        let problem: string | null;
        let doc: Record<string, unknown> | null = null;
        try {
          doc = migrate(raw, APPLICATIONS_SCHEMA_VERSION, LIST_MIGRATIONS);
          problem = validateList(doc);
        } catch (err) {
          if (!(err instanceof MigrationError)) throw err;
          problem = err.message;
        }
        if (problem || !doc) this.setAsideList('invalid', forLog(problem ?? 'not a list'));
        else ids = (doc as { applications: ApplicationSummary[] }).applications.map((s) => s.id);
      }
    } catch (err) {
      if (!(err instanceof CorruptJsonError)) throw err;
      this.setAsideList('corrupt', 'not JSON');
    }
    // Rebuild from the folders whenever the list is missing or broken.
    const candidates = ids ?? fs.readdirSync(this.dir, { withFileTypes: true }).filter((e) => e.isDirectory() && APPLICATION_ID.test(e.name)).map((e) => e.name);
    for (const id of candidates) {
      const p = this.readPackage(id);
      if (p) this.packages.set(id, p);
    }
    this.writeList();
    return this.list();
  }

  list(): ApplicationSummary[] {
    return [...this.packages.values()].map(summaryOf).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  /** Every package (clones). */
  all(): ApplicationPackage[] {
    return [...this.packages.values()].map((p) => structuredClone(p));
  }

  get(id: string): ApplicationPackage | undefined {
    const p = this.packages.get(id);
    return p ? structuredClone(p) : undefined;
  }

  require(id: string): ApplicationPackage {
    const p = this.get(id);
    if (!p) throw new AppError('NOT_FOUND', `application ${id}`);
    return p;
  }

  /** The package a vacancy links to: the one still being edited if any, else the newest (sent ones stay, a copy may follow). */
  byVacancy(vacancyId: string): ApplicationSummary | undefined {
    const all = this.list().filter((s) => s.vacancyId === vacancyId);
    return all.find((s) => !FROZEN.has(s.status)) ?? all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];
  }

  /** The one package of a vacancy that is not sent yet (only one may be edited at a time). */
  editableByVacancy(vacancyId: string): ApplicationSummary | undefined {
    return this.list().find((s) => s.vacancyId === vacancyId && !FROZEN.has(s.status));
  }

  save(pkg: ApplicationPackage, files: { vacancyText?: string; photo?: PhotoFile | null }): ApplicationPackage {
    if (!APPLICATION_ID.test(pkg.id)) throw new AppError('BAD_REQUEST', 'unsafe application id');
    const next = structuredClone(pkg);
    if (files.photo !== undefined) next.snapshot.photo = files.photo ? files.photo.ext : null;
    this.check(next);
    const folder = this.folder(next.id);
    try {
      fs.mkdirSync(folder, { recursive: true });
      if (files.vacancyText !== undefined) fs.writeFileSync(path.join(folder, 'vacancy.txt'), files.vacancyText, 'utf8');
      if (files.photo !== undefined) this.writePhoto(next.id, files.photo);
      writeJsonAtomic(path.join(folder, 'package.json'), next);
    } catch (err) {
      throw new AppError('DATA_WRITE_FAILED', String(err));
    }
    this.packages.set(next.id, next);
    this.writeList();
    return structuredClone(next);
  }

  update(id: string, change: (p: ApplicationPackage) => void): ApplicationPackage {
    const next = this.require(id);
    change(next);
    if (next.id !== id) throw new AppError('BAD_REQUEST', 'the id of a package cannot change');
    return this.save(next, {});
  }

  setPhoto(id: string, photo: PhotoFile | null): void {
    const p = this.require(id);
    this.save(p, { photo });
  }

  remove(id: string): void {
    this.require(id);
    fs.rmSync(this.folder(id), { recursive: true, force: true });
    this.packages.delete(id);
    this.writeList();
  }

  readVacancyText(id: string): string {
    if (!APPLICATION_ID.test(id)) return '';
    try {
      return fs.readFileSync(path.join(this.folder(id), 'vacancy.txt'), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw err;
    }
  }

  photoPath(id: string): string | null {
    const p = this.packages.get(id);
    if (!p || !p.snapshot.photo) return null;
    const file = path.join(this.folder(id), `photo${p.snapshot.photo}`);
    return fs.existsSync(file) ? file : null;
  }

  private check(p: ApplicationPackage): void {
    const problem = validatePackage(p);
    if (problem) throw new AppError('BAD_REQUEST', `package would become invalid: ${forLog(problem)}`);
  }

  private writePhoto(id: string, photo: PhotoFile | null): void {
    const folder = this.folder(id);
    for (const ext of ['.jpg', '.png']) fs.rmSync(path.join(folder, `photo${ext}`), { force: true });
    if (photo) fs.writeFileSync(path.join(folder, `photo${photo.ext}`), photo.data);
  }

  private readPackage(id: string): ApplicationPackage | null {
    const file = path.join(this.folder(id), 'package.json');
    let raw: unknown;
    try {
      raw = readJson<unknown>(file);
    } catch (err) {
      if (!(err instanceof CorruptJsonError)) throw err;
      this.setAsidePackage(id, 'corrupt', 'not JSON');
      return null;
    }
    if (raw === null) return null;
    try {
      const doc = migrate(raw, PACKAGE_SCHEMA_VERSION, PACKAGE_MIGRATIONS);
      const problem = validatePackage(doc);
      if (problem) throw new MigrationError(forLog(problem));
      return doc as unknown as ApplicationPackage;
    } catch (err) {
      if (!(err instanceof MigrationError)) throw err;
      this.setAsidePackage(id, 'invalid', forLog(err.message));
      return null;
    }
  }

  private writeList(): void {
    const doc = { schemaVersion: APPLICATIONS_SCHEMA_VERSION, applications: this.list() };
    try {
      writeJsonAtomic(this.listFile(), doc);
    } catch (err) {
      throw new AppError('DATA_WRITE_FAILED', String(err));
    }
  }

  private folder(id: string): string {
    if (!APPLICATION_ID.test(id)) throw new AppError('BAD_REQUEST', 'unsafe application id');
    return path.join(this.dir, id);
  }

  private listFile(): string {
    return path.join(this.dir, 'applications.json');
  }

  private setAsideList(kind: 'corrupt' | 'invalid', reason: string): void {
    const backup = path.join(this.dir, `applications.${kind}-${Date.now()}.json`);
    fs.renameSync(this.listFile(), backup);
    this.warn(`applications_${kind}`, { backup, reason });
  }

  private setAsidePackage(id: string, kind: 'corrupt' | 'invalid', reason: string): void {
    const file = path.join(this.folder(id), 'package.json');
    const backup = path.join(this.folder(id), `package.${kind}-${Date.now()}.json`);
    fs.renameSync(file, backup);
    this.warn(`application_${kind}`, { id, reason });
  }
}
