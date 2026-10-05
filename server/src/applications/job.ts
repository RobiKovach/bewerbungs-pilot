import crypto from 'node:crypto';
import type { ApplicationJobState, ApplicationPackage, DocLanguage, PackageLetter, PackageSnapshot, PackageVacancy, Profile, Vacancy } from '@bp/shared';
import { CorruptJsonError, readJson, writeJsonAtomic } from '../data/atomic.js';
import { AppError } from '../errors.js';
import type { LlmQueue } from '../llm/queue.js';
import type { LlmTask } from '../llm/types.js';
import type { Logger } from '../log.js';
import type { VacancyStore } from '../vacancies/store.js';
import { checkCv, checkLetter, mergeChecks, toCv, type CheckResult } from './checks.js';
import { buildRecipient, buildSalutation, closingFor, mentionHomeOffice } from './letter-parts.js';
import { countPages, type PdfPrinter } from './pdf.js';
import { assertPackageReady } from './readiness.js';
import { letterHtml } from './render/letter.js';
import { PACKAGE_SCHEMA_VERSION } from './schema.js';
import { profileFingerprint, sameCvInputs, takeSnapshot, translatableValues } from './snapshot.js';
import type { ApplicationStore, PhotoFile } from './store.js';
import { packageContext, type CreateOutput, type CvOutput, type LetterOutput, type PackageContext } from './tasks/context.js';
import { createPackageTask } from './tasks/create-package.js';
import { refreshCvTask } from './tasks/refresh-cv.js';
import { reviseLetterTask, SHORTEN_INSTRUCTION, withFeedback } from './tasks/revise-letter.js';

export type JobRequest =
  | { kind: 'create'; vacancyId: string; language: DocLanguage }
  | { kind: 'recreate'; applicationId: string; language: DocLanguage }
  | { kind: 'revise'; applicationId: string; instruction: string }
  | { kind: 'refreshCv'; applicationId: string; keepProfil: boolean; keepHeadline: boolean };

export interface ApplicationJobDeps {
  store: ApplicationStore; vacancies: VacancyStore; queue: LlmQueue; printer: PdfPrinter; logger: Logger;
  profile: () => Profile;
  /** The profile photo's bytes (null = none or the file is gone). */
  photo: (p: Profile) => PhotoFile | null;
  stateFile: string;
  newId?: () => string; now?: () => Date;
}

export function idleJobState(): ApplicationJobState {
  return { state: 'idle', kind: null, vacancyId: null, applicationId: null, error: null, startedAt: null, finishedAt: null };
}

/** Any change the person did not approve yet makes the package a draft again (spec, section 1). */
export function touchDraft(p: ApplicationPackage, now: Date): void {
  p.status = 'draft';
  p.approvedAt = null;
  p.updatedAt = now.toISOString();
}

export function toPackageVacancy(v: Vacancy): PackageVacancy {
  return { id: v.id, title: v.title, company: v.company, locations: [...v.locations], remote: v.remote, contact: v.contact ? { ...v.contact } : null, url: v.url };
}

/** The Claude-written letter fields, trimmed; the server-built parts of `base` stay as they are. */
function withLetterFields(base: PackageLetter, out: LetterOutput): PackageLetter {
  return { ...base, subject: out.subject.trim(), paragraphs: out.paragraphs.map((p) => p.trim()), storyIds: out.storyIds, hint: out.hint?.trim() || null };
}

/**
 * "Update CV" asks Claude when the CV inputs changed — or when the CV still lacks what Claude writes: a package from
 * 0.4.0 (migrated v1) has no headline, one unnamed skill group and no translations (spec: old packages work "until Update CV").
 */
function cvNeedsClaude(existing: ApplicationPackage, snapshot: PackageSnapshot): boolean {
  const cv = existing.cv;
  return !sameCvInputs(existing.snapshot, snapshot) || cv.headline === '' || cv.skillGroups.some((g) => g.name === '')
    || translatableValues(snapshot).some((v) => !Object.hasOwn(cv.translations, v));
}

const isCancel = (err: unknown, signal: AbortSignal) => signal.aborted || (err instanceof AppError && err.code === 'LLM_CANCELLED');

/** One package job at a time, in the background; the page polls GET /api/applications/job (spec, section 5). */
export class ApplicationJob {
  private current: ApplicationJobState = idleJobState();
  private ctrl: AbortController | null = null;
  private running: Promise<void> = Promise.resolve();
  private readonly newId: () => string;
  private readonly now: () => Date;

  constructor(private readonly d: ApplicationJobDeps) {
    this.newId = d.newId ?? (() => crypto.randomUUID());
    this.now = d.now ?? (() => new Date());
  }

  init(): void {
    let saved: ApplicationJobState | null = null;
    try {
      saved = readJson<ApplicationJobState>(this.d.stateFile);
    } catch (err) {
      if (!(err instanceof CorruptJsonError)) throw err;
      this.d.logger.warn('application_job_state_corrupt', {});
    }
    this.current = saved && typeof saved === 'object' && typeof saved.state === 'string' ? { ...idleJobState(), ...saved } : idleJobState();
    if (this.current.state === 'running') this.set({ state: 'interrupted', finishedAt: this.stamp() });
  }

  state(): ApplicationJobState {
    return structuredClone(this.current);
  }

  busyWith(applicationId: string): boolean {
    return this.current.state === 'running' && this.current.applicationId === applicationId;
  }

  start(req: JobRequest): ApplicationJobState {
    if (this.current.state === 'running') throw new AppError('CONFLICT', 'a package job is running', 'packageBusy');
    const profile = this.d.profile();
    let vacancyId: string;
    let applicationId: string | null = null;
    if (req.kind === 'create') {
      const v = this.d.vacancies.require(req.vacancyId);
      if (v.status !== 'favorite') throw new AppError('CONFLICT', `vacancy is ${v.status}, not favorite`);
      const existing = this.d.store.byVacancy(v.id);
      if (existing) throw new AppError('PACKAGE_EXISTS', existing.id, undefined, { id: existing.id });
      assertPackageReady(profile);
      this.assertBrowser();
      vacancyId = v.id;
    } else {
      const p = this.d.store.require(req.applicationId);
      if (req.kind === 'recreate') assertPackageReady(profile);
      if (req.kind !== 'refreshCv') this.assertBrowser();
      vacancyId = p.vacancyId;
      applicationId = p.id;
    }
    this.ctrl = new AbortController();
    this.set({ ...idleJobState(), state: 'running', kind: req.kind, vacancyId, applicationId, startedAt: this.stamp() });
    const signal = this.ctrl.signal;
    this.running = this.run(req, profile, signal).then(
      (id) => { this.set({ state: 'done', applicationId: id, finishedAt: this.stamp() }); },
      (err: unknown) => this.fail(err, signal, req.kind),
    );
    return this.state();
  }

  cancel(): void {
    this.ctrl?.abort();
  }

  whenIdle(): Promise<void> {
    return this.running;
  }

  private async run(req: JobRequest, profile: Profile, signal: AbortSignal): Promise<string> {
    if (req.kind === 'create') return this.create(req.vacancyId, req.language, profile, signal, null);
    const existing = this.d.store.require(req.applicationId);
    if (req.kind === 'recreate') return this.create(existing.vacancyId, req.language, profile, signal, existing);
    if (req.kind === 'revise') return this.revise(existing, req.instruction, profile, signal);
    return this.refreshCv(existing, req.keepProfil, req.keepHeadline, profile, signal);
  }

  private async create(vacancyId: string, language: DocLanguage, profile: Profile, signal: AbortSignal, previous: ApplicationPackage | null): Promise<string> {
    // Recreate works from the package's own copy (the vacancy may be hidden or compacted by now).
    const vacancy = previous ? previous.vacancy : toPackageVacancy(this.d.vacancies.require(vacancyId));
    const text = previous ? this.d.store.readVacancyText(previous.id) : (this.d.vacancies.readText(vacancyId) ?? '');
    const ctx = packageContext(profile, language, mentionHomeOffice(profile, vacancy));
    const out = await this.ask<CreateOutput>(createPackageTask(ctx, vacancy, text), (o) => mergeChecks(checkLetter(o, ctx), checkCv(o, ctx)), signal);
    const now = this.now().toISOString();
    const pkg: ApplicationPackage = {
      schemaVersion: PACKAGE_SCHEMA_VERSION,
      id: previous?.id ?? this.newId(),
      vacancyId,
      language,
      status: 'draft',
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      approvedAt: null,
      profileFingerprint: profileFingerprint(profile),
      snapshot: takeSnapshot(profile),
      vacancy,
      letter: withLetterFields({
        recipient: buildRecipient(vacancy), subject: '', salutation: buildSalutation(vacancy.contact, language),
        paragraphs: [], closing: closingFor(language), signature: profile.sections.personal.data.fullName.trim(),
        storyIds: [], hint: null, pages: 0,
      }, out),
      cv: { ...toCv(out), profilEditedByHand: false, headlineEditedByHand: false },
      attachments: previous?.attachments ?? profile.documents.filter((doc) => doc.attachAlways).map((doc) => doc.id),
    };
    pkg.letter = await this.fitOnePage(pkg, ctx, text, signal);
    signal.throwIfAborted();
    return this.d.store.save(pkg, { vacancyText: text, photo: this.d.photo(profile) }).id;
  }

  private async revise(existing: ApplicationPackage, instruction: string, profile: Profile, signal: AbortSignal): Promise<string> {
    const text = this.d.store.readVacancyText(existing.id);
    const ctx = packageContext(profile, existing.language, mentionHomeOffice(profile, existing.vacancy));
    const out = await this.ask<LetterOutput>(reviseLetterTask(ctx, existing.vacancy, text, existing.letter, instruction), (o) => checkLetter(o, ctx), signal);
    const next = structuredClone(existing);
    next.letter = withLetterFields(next.letter, out);
    next.letter = await this.fitOnePage(next, ctx, text, signal);
    signal.throwIfAborted();
    const now = this.now();
    return this.d.store.update(existing.id, (p) => { p.letter = next.letter; touchDraft(p, now); }).id;
  }

  private async refreshCv(existing: ApplicationPackage, keepProfil: boolean, keepHeadline: boolean, profile: Profile, signal: AbortSignal): Promise<string> {
    const snapshot = takeSnapshot(profile);
    let cv = existing.cv;
    if (cvNeedsClaude(existing, snapshot)) {
      const text = this.d.store.readVacancyText(existing.id);
      const ctx = packageContext(profile, existing.language, mentionHomeOffice(profile, existing.vacancy));
      const out = await this.ask<CvOutput>(refreshCvTask(ctx, existing.vacancy, text), (o) => checkCv(o, ctx), signal);
      const fresh = toCv(out);
      const keepP = keepProfil && existing.cv.profilEditedByHand;
      const keepH = keepHeadline && existing.cv.headlineEditedByHand;
      cv = {
        ...fresh, profil: keepP ? existing.cv.profil : fresh.profil, profilEditedByHand: keepP,
        headline: keepH ? existing.cv.headline : fresh.headline, headlineEditedByHand: keepH,
      };
    }
    signal.throwIfAborted();
    const next = structuredClone(existing);
    next.snapshot = snapshot;
    next.profileFingerprint = profileFingerprint(profile);
    next.cv = cv;
    touchDraft(next, this.now());
    return this.d.store.save(next, { photo: this.d.photo(profile) }).id;
  }

  /** Claude + code checks: fatal → error at once; rule violations → one retry with feedback (spec, section 3). */
  private async ask<T>(task: LlmTask, check: (out: T) => CheckResult, signal: AbortSignal): Promise<T> {
    let out = await this.d.queue.run<T>(task, signal);
    let r = check(out);
    if (r.fatal) throw new AppError('LLM_BAD_OUTPUT', `package check: ${r.fatal}`);
    if (r.violations.length === 0) return out;
    out = await this.d.queue.run<T>(withFeedback(task, r.violations), signal);
    r = check(out);
    if (r.fatal) throw new AppError('LLM_BAD_OUTPUT', `package check after retry: ${r.fatal}`);
    if (r.violations.length > 0) throw new AppError('PACKAGE_RULES_BROKEN', `${r.violations.length} rule violation(s) after one retry`);
    return out;
  }

  /** Print, count; more than one page → one shorten call, count again (spec, section 3). */
  private async fitOnePage(pkg: ApplicationPackage, ctx: PackageContext, text: string, signal: AbortSignal): Promise<PackageLetter> {
    const pagesOf = async (p: ApplicationPackage) => countPages(await this.d.printer.print(letterHtml(p, this.now())));
    let letter = { ...pkg.letter, pages: await pagesOf(pkg) };
    if (letter.pages <= 1) return letter;
    signal.throwIfAborted();
    const out = await this.ask<LetterOutput>(reviseLetterTask(ctx, pkg.vacancy, text, letter, SHORTEN_INSTRUCTION, true), (o) => checkLetter(o, ctx), signal);
    letter = withLetterFields(letter, out);
    return { ...letter, pages: await pagesOf({ ...pkg, letter }) };
  }

  private assertBrowser(): void {
    if (!this.d.printer.available()) throw new AppError('BROWSER_MISSING', 'no Edge or Chrome found');
  }

  private fail(err: unknown, signal: AbortSignal, kind: JobRequest['kind']): void {
    if (isCancel(err, signal)) {
      this.set({ state: 'cancelled', finishedAt: this.stamp() });
      return;
    }
    const code = err instanceof AppError ? err.code : 'UNKNOWN';
    const detailsForLog = err instanceof AppError ? err.detailsForLog.slice(0, 300) : String(err).slice(0, 300);
    this.d.logger.warn('application_job_failed', { kind, code });
    this.set({ state: 'failed', error: { code, detailsForLog }, finishedAt: this.stamp() });
  }

  private set(change: Partial<ApplicationJobState>): void {
    this.current = { ...this.current, ...change };
    try {
      writeJsonAtomic(this.d.stateFile, this.current);
    } catch (err) {
      this.d.logger.warn('application_job_state_not_written', { message: String(err).slice(0, 200) });
    }
  }

  private stamp(): string {
    return this.now().toISOString();
  }
}
