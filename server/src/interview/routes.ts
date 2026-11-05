import type { FastifyInstance } from 'fastify';
import type { ApplicationPackage, ApplicationStatus, InterviewPrep, InterviewPrepView, PrepFeedback, PrepKind, PrepQuestion, Profile } from '@bp/shared';
import { isInitiative } from '../applications/initiative.js';
import { APPLICATION_ID } from '../applications/schema.js';
import type { ApplicationStore } from '../applications/store.js';
import { packageContext } from '../applications/tasks/context.js';
import { withFeedback } from '../applications/tasks/revise-letter.js';
import type { SettingsStore } from '../data/settings.js';
import { AppError } from '../errors.js';
import { abortOnClose } from '../http.js';
import type { LlmQueue } from '../llm/queue.js';
import type { LlmTask } from '../llm/types.js';
import type { Logger } from '../log.js';
import type { Activity } from '../runtime/activity.js';
import type { VacancyStore } from '../vacancies/store.js';
import { answersFingerprint, chancePercent } from './chance.js';
import { PREP_LIMITS, PREP_SCHEMA_VERSION } from './schema.js';
import { InterviewPrepStore } from './store.js';
import { feedbackTask, PREP_SET, questionsTask, questionsViolations, summaryTask, summaryViolations, type FeedbackOutput, type QuestionsOutput, type SummaryOutput, type TaskCtx } from './tasks.js';

export interface InterviewRouteDeps {
  store: ApplicationStore; vacancies: VacancyStore; profile: () => Profile; settings: SettingsStore;
  queue: LlmQueue; activity: Activity; logger: Logger; now?: () => Date;
}

/** Spec 5.1: from the moment an application has left the app until it is decided. */
const OPEN: ReadonlySet<ApplicationStatus> = new Set<ApplicationStatus>(['sent', 'submitted', 'interview']);
const CLOSED: ReadonlySet<ApplicationStatus> = new Set<ApplicationStatus>(['rejected', 'offer', 'withdrawn']);

const LANGUAGE = { enum: ['de', 'en'] };
const ID = { type: 'string', pattern: APPLICATION_ID.source };
const idParams = { type: 'object', required: ['id'], properties: { id: ID } };
const questionParams = { type: 'object', required: ['id', 'qid'], properties: { id: ID, qid: ID } };
const startBody = { type: 'object', additionalProperties: false, required: ['language'], properties: { language: LANGUAGE, replace: { type: 'boolean' } } };
const answerBody = {
  type: 'object', additionalProperties: false, required: ['text', 'dontKnow', 'setCreatedAt'],
  properties: { text: { type: 'string', maxLength: PREP_LIMITS.answer }, dontKnow: { type: 'boolean' }, setCreatedAt: { type: 'string', maxLength: 64 } },
};
const emptyBody = { type: 'object', additionalProperties: false, properties: {} };

/** Order of the set, ids and "code only in the practice task" are the server's: the AI's order is not relied on. */
export function normalizeQuestions(out: QuestionsOutput): PrepQuestion[] {
  const kinds = Object.keys(PREP_SET) as PrepKind[];
  return kinds
    .flatMap((kind) => out.questions.filter((q) => q.kind === kind))
    .map((q, i) => ({ id: `q${i + 1}`, kind: q.kind, text: q.text.trim(), code: q.kind === 'practice' && q.code?.trim() ? q.code : null, answer: null }));
}

const allHaveFeedback = (prep: InterviewPrep): boolean => prep.questions.every((q) => q.answer?.feedback);
const summaryFits = (prep: InterviewPrep): boolean => allHaveFeedback(prep) && prep.summary?.fingerprint === answersFingerprint(prep);

/** "I don't know" is weak and has nothing to correct, whatever the AI said (spec 5.3). */
const settledFeedback = (out: FeedbackOutput, dontKnow: boolean): PrepFeedback => (dontKnow ? { ...out, weak: true, languageFixes: [] } : out);

export async function registerInterviewRoutes(app: FastifyInstance, d: InterviewRouteDeps): Promise<void> {
  const now = d.now ?? (() => new Date());
  const prepStore = new InterviewPrepStore(d.store.dir, (event, data) => d.logger.warn(event, data));
  const working = new Set<string>();

  /** A file that cannot be read (locked, a folder, cannot be put aside) is a clean refusal: never its path or content. */
  const readPrep = (id: string): InterviewPrep | null => {
    try {
      return prepStore.read(id);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('CONFLICT', `preparation file: ${(err as NodeJS.ErrnoException).code ?? 'UNKNOWN'}`, 'prepUnreadable');
    }
  };

  const viewOf = (p: ApplicationPackage): InterviewPrepView => {
    const stored = readPrep(p.id);
    const canStart = OPEN.has(p.status);
    // The file keeps an outdated summary as the source of previousPercent; the person sees only one that fits the answers.
    const prep = stored && !summaryFits(stored) ? { ...stored, summary: null } : stored;
    return { prep, canStart, readOnly: CLOSED.has(p.status) || (!canStart && prep !== null), defaultLanguage: p.language };
  };

  /** Changes are for open applications only. */
  const requireOpen = (p: ApplicationPackage): void => {
    if (CLOSED.has(p.status)) throw new AppError('CONFLICT', 'the application is decided', 'prepReadOnly');
    if (!OPEN.has(p.status)) throw new AppError('CONFLICT', 'the application has not left the app', 'prepNotAvailable');
  };

  /** Everything that changes a preparation: refusals first, then one at a time per application, announced to restore and update. */
  const exclusive = async <T>(id: string, action: string, work: (start: ApplicationPackage) => Promise<T>): Promise<T> => {
    const start = d.store.require(id);
    requireOpen(start);
    d.activity.refuseDuringRestore();
    if (working.has(id)) throw new AppError('CONFLICT', 'the preparation is being worked on', 'prepBusy');
    working.add(id);
    const end = d.activity.begin('interview');
    try {
      const out = await work(start);
      d.logger.info('interview_prep', { id, action, result: 'ok' });
      return out;
    } catch (err) {
      d.logger.warn('interview_prep', { id, action, result: err instanceof AppError ? err.code : 'UNKNOWN' });
      throw err;
    } finally {
      end();
      working.delete(id);
    }
  };

  /** Never a reason to fail: without the text the questions come from the letter and the profile. */
  const vacancyTextOf = (p: ApplicationPackage): string => {
    try {
      return d.store.readVacancyText(p.id) || d.vacancies.readText(p.vacancyId) || '';
    } catch {
      return '';
    }
  };

  const contextOf = (p: ApplicationPackage, language: 'de' | 'en'): TaskCtx => ({
    ctx: packageContext(d.profile(), language, false, isInitiative(p.vacancy)),
    pkg: p, vacancyText: vacancyTextOf(p), language, uiLanguage: d.settings.get().language ?? 'en',
  });

  /** One retry with the complaints, then LLM_BAD_OUTPUT. The kinds in the log name no text. */
  const askChecked = async <T>(task: LlmTask, problems: (out: T) => string[], kind: string, signal: AbortSignal): Promise<T> => {
    let answer = (await d.queue.runTagged<T>(task, signal)).value;
    const first = problems(answer);
    if (first.length === 0) return answer;
    answer = (await d.queue.runTagged<T>(withFeedback(task, first), signal)).value;
    if (problems(answer).length > 0) throw new AppError('LLM_BAD_OUTPUT', kind);
    return answer;
  };

  /** While the AI worked the application may have been decided or deleted, or the set replaced: its result is then stale. Sent → interview is not. */
  const stillCurrent = (start: ApplicationPackage, createdAt: string | null): { pkg: ApplicationPackage; prep: InterviewPrep | null } => {
    const pkg = d.store.get(start.id);
    if (!pkg) throw new AppError('NOT_FOUND', `application ${start.id}`);
    const prep = readPrep(start.id);
    if (!OPEN.has(pkg.status) || (prep?.createdAt ?? null) !== createdAt) throw new AppError('CONFLICT', 'changed while the AI worked', 'packageChanged');
    return { pkg, prep };
  };

  app.get('/api/applications/:id/interview', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    return viewOf(d.store.require(id));
  });

  app.post('/api/applications/:id/interview', { schema: { params: idParams, body: startBody } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { language, replace } = req.body as { language: 'de' | 'en'; replace?: boolean };
    return exclusive(id, 'start', async (start) => {
      const existing = readPrep(id);
      if (existing && !replace) throw new AppError('CONFLICT', 'a preparation exists', 'prepExists');
      const out = await askChecked<QuestionsOutput>(questionsTask(contextOf(start, language)), questionsViolations, 'questions', abortOnClose(reply));
      const { pkg } = stillCurrent(start, existing?.createdAt ?? null);
      const at = now().toISOString();
      prepStore.write({
        schemaVersion: PREP_SCHEMA_VERSION, applicationId: id, language, createdAt: at, updatedAt: at,
        questions: normalizeQuestions(out), employerQuestions: out.employerQuestions.map((q) => q.trim()), summary: null,
      });
      return viewOf(pkg);
    });
  });

  app.post('/api/applications/:id/interview/questions/:qid/answer', { schema: { params: questionParams, body: answerBody } }, async (req, reply) => {
    const { id, qid } = req.params as { id: string; qid: string };
    const body = req.body as { text: string; dontKnow: boolean; setCreatedAt: string };
    if (!body.dontKnow && !body.text.trim()) throw new AppError('BAD_REQUEST', 'an answer needs a text');
    const text = body.dontKnow ? '' : body.text.trim();
    return exclusive(id, 'answer', async (start) => {
      const prep = readPrep(id);
      // Question ids repeat between sets: an answer written for the set a stale page showed must not land on another.
      if (prep && prep.createdAt !== body.setCreatedAt) throw new AppError('CONFLICT', 'question set changed', 'packageChanged');
      const question = prep?.questions.find((q) => q.id === qid);
      if (!prep || !question) throw new AppError('NOT_FOUND', 'no such question');
      // Saved first: a failed or cancelled AI call never costs the person the answer.
      const updatedAt = now().toISOString();
      question.answer = { text, dontKnow: body.dontKnow, updatedAt, feedback: null };
      prep.updatedAt = updatedAt;
      prepStore.write(prep);

      const task = feedbackTask(contextOf(start, prep.language), question, { text, dontKnow: body.dontKnow });
      const { value } = await d.queue.runTagged<FeedbackOutput>(task, abortOnClose(reply));

      const current = stillCurrent(start, prep.createdAt);
      const answer = current.prep?.questions.find((q) => q.id === qid)?.answer;
      if (!current.prep || !answer || answer.updatedAt !== updatedAt) throw new AppError('CONFLICT', 'changed while the AI worked', 'packageChanged');
      answer.feedback = settledFeedback(value, body.dontKnow);
      current.prep.updatedAt = now().toISOString();
      prepStore.write(current.prep);
      return viewOf(current.pkg);
    });
  });

  app.post('/api/applications/:id/interview/summary', { schema: { params: idParams, body: emptyBody } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return exclusive(id, 'summary', async (start) => {
      const prep = readPrep(id);
      if (!prep) throw new AppError('NOT_FOUND', 'no preparation');
      if (!allHaveFeedback(prep)) throw new AppError('CONFLICT', 'not all questions are done', 'prepNotFinished');
      if (summaryFits(prep)) return viewOf(start);
      const fingerprint = answersFingerprint(prep);

      const previousPercent = prep.summary?.percent ?? null;
      const out = await askChecked<SummaryOutput>(summaryTask(contextOf(start, prep.language), prep, previousPercent), (o) => summaryViolations(o, prep), 'summary', abortOnClose(reply));

      const current = stillCurrent(start, prep.createdAt);
      if (!current.prep || answersFingerprint(current.prep) !== fingerprint) throw new AppError('CONFLICT', 'changed while the AI worked', 'packageChanged');
      const weak = current.prep.questions.filter((q) => q.answer?.feedback?.weak).length;
      const at = now().toISOString();
      current.prep.summary = {
        percent: chancePercent(out.percent, weak, current.prep.questions.length), previousPercent,
        areas: out.areas, biggestRisk: out.biggestRisk, fingerprint, createdAt: at,
      };
      current.prep.updatedAt = at;
      prepStore.write(current.prep);
      return viewOf(current.pkg);
    });
  });
}
