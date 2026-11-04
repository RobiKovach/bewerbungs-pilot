import { describe, it, expect } from 'vitest';
import type { InterviewPrep, PackageVacancy, PrepFeedback, PrepQuestion } from '@bp/shared';
import { checkCv, checkLetter } from '../src/applications/checks.js';
import { feedbackTask, questionsTask, questionsViolations, summaryTask, summaryViolations, type QuestionsOutput, type SummaryOutput, type TaskCtx } from '../src/interview/tasks.js';
import { packageContext, type CreateOutput, type CvOutput, type LetterOutput } from '../src/applications/tasks/context.js';
import { createPackageTask } from '../src/applications/tasks/create-package.js';
import { offerReplyTask, offerReplyViolations } from '../src/applications/tasks/offer-reply.js';
import { refreshCvTask } from '../src/applications/tasks/refresh-cv.js';
import { reviseLetterTask, withFeedback } from '../src/applications/tasks/revise-letter.js';
import { scriptedResponse } from '../src/llm/fake-scripted.js';
import { LLM_TASK_IDS, type LlmTask, type LlmTaskId } from '../src/llm/types.js';
import { validateOutput } from '../src/llm/validate.js';
import { extractCvTask, toSectionData, type ExtractedCv } from '../src/profile/tasks/extract-cv.js';
import { followUpTask, toQuestions, type FollowUpOutput } from '../src/profile/tasks/follow-up.js';
import { structureStoriesTask, toStories, type StoriesOutput } from '../src/profile/tasks/structure-stories.js';
import { helloTask } from '../src/prompts/hello.js';
import { extractManualTask, toManualFields, type ManualOutput } from '../src/vacancies/tasks/extract-manual.js';
import { contactNameTask, withContactName, type ContactNameOutput } from '../src/vacancies/tasks/contact-name.js';
import { scoreTask, type ScoreOutput } from '../src/vacancies/tasks/score.js';
import { emptyContact } from '../src/vacancies/contact-parse.js';
import { pkg, readyPackageProfile } from './helpers/applications.js';

const VAC: PackageVacancy = { id: 'v1', title: 'Webentwickler (m/w/d)', company: 'Muster GmbH', locations: ['Hamburg'], remote: 'partial', contact: null, url: '' };
const PASTED = 'Webentwickler (m/w/d)\nMuster GmbH\n20095 Hamburg\nWir suchen Verstärkung. Bewerbung an jobs@muster.example, Ansprechpartnerin Frau Erika Beispiel.';
const CONTACT_WINDOW = 'Ihre Ansprechpartnerin\nFrau Erika Musterfrau\nE-Mail: bewerbung@muster.example';
const ctx = (language: 'de' | 'en' = 'de') => packageContext(readyPackageProfile(), language, false);
const id = (n: number) => () => `id-${n}`;
const PREP_CTX = (): TaskCtx => ({ ctx: ctx(), pkg: pkg(), vacancyText: 'Wir suchen.', language: 'de', uiLanguage: 'uk' });
const PREP_QUESTION: PrepQuestion = { id: 'q1', kind: 'theory', text: 'Was ist React?', code: null, answer: null };
/** A set with one answered question per entry; the entry says whether the answer was weak. */
const prepWith = (weak: boolean[]): InterviewPrep => ({
  schemaVersion: 1, applicationId: 'app-1', language: 'de', createdAt: '2026-11-04T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z', employerQuestions: [], summary: null,
  questions: weak.map((w, i) => ({ ...PREP_QUESTION, id: `q${i + 1}`, answer: { text: 'Antwort', dontKnow: false, updatedAt: '2026-11-04T10:00:00.000Z', feedback: { weak: w, content: 'c', languageFixes: [], better: 'b' } } })),
});

/**
 * One real task per kind, built by the app's own task builders. Typed as Record<LlmTaskId, …> so a new task id
 * without an entry here fails the typecheck, and the runtime check below fails too.
 */
const TASKS: Record<LlmTaskId, () => LlmTask> = {
  probe: () => ({ id: 'probe', prompt: 'Answer with ok = true.', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, replyLanguage: 'en' }),
  hello: () => helloTask('de'),
  'extract-cv': () => extractCvTask({ kind: 'text', text: 'Max Mustermann, Webentwickler, Berlin. JavaScript, CSS.' }, 'en'),
  'follow-up': () => followUpTask(readyPackageProfile(), 'uk'),
  'structure-stories': () => structureStoriesTask([{ question: 'Ein Projekt?', answer: 'Ich habe für einen Bäcker einen Online-Shop gebaut.' }], ['Kunde X'], 'de'),
  'extract-manual': () => extractManualTask(PASTED, readyPackageProfile(), 'en'),
  score: () => scoreTask([
    { id: 'aa-1', title: 'Webentwickler', company: 'A GmbH', locations: ['Berlin'], remote: 'no', employment: ['fulltime'], salaryText: '', text: 'Text eins' },
    { id: 'aa-2', title: 'Frontend', company: 'B GmbH', locations: ['Dresden'], remote: 'yes', employment: [], salaryText: '', text: 'Text zwei' },
  ], readyPackageProfile(), 'en'),
  'create-package': () => createPackageTask(ctx(), VAC, 'Wir suchen einen Webentwickler.'),
  'refresh-cv': () => refreshCvTask(ctx('en'), VAC, 'We are hiring.'),
  'revise-letter': () => reviseLetterTask(ctx(), VAC, 'Wir suchen.', pkg().letter, 'Mach es kürzer'),
  'offer-reply': () => offerReplyTask(ctx(), pkg(), '50.000 €', '55.000 €'),
  'contact-name': () => contactNameTask(CONTACT_WINDOW, 'de'),
  'interview-questions': () => questionsTask(PREP_CTX()),
  'interview-feedback': () => feedbackTask(PREP_CTX(), PREP_QUESTION, { text: 'Eine ausreichend lange Antwort auf die Frage.', dontKnow: false }),
  'interview-summary': () => summaryTask(PREP_CTX(), prepWith([false, true]), null),
};

describe('scriptedResponse (fake AI for end-to-end runs)', () => {
  it('covers exactly the task ids the app defines', () => {
    expect(Object.keys(TASKS).sort()).toEqual([...LLM_TASK_IDS].sort());
    for (const [key, build] of Object.entries(TASKS)) expect(build().id).toBe(key);
  });

  it.each([...LLM_TASK_IDS])('answers %s with output that passes the task\'s own schema', (taskId) => {
    const task = TASKS[taskId]();
    const out = scriptedResponse(task);
    expect(validateOutput(task.schema, out)).toEqual({ ok: true });
  });

  it('throws with the task id for an unknown task', () => {
    const task = { ...helloTask('en'), id: 'brand-new-task' } as unknown as LlmTask;
    expect(() => scriptedResponse(task)).toThrow(/brand-new-task/);
  });

  it('extract-cv: a readable fictional CV the profile can use (file input too)', () => {
    for (const task of [TASKS['extract-cv'](), extractCvTask({ kind: 'file', path: 'C:/x/cv.pdf' }, 'de')]) {
      const cv = scriptedResponse(task) as ExtractedCv;
      expect(cv.readable).toBe(true);
      const data = toSectionData(cv, id(1));
      expect(data.personal.fullName).toBe('Max Mustermann');
      expect(data.skills.items.length).toBeGreaterThanOrEqual(3);
      expect(data.experience.items[0].description).not.toBe('');
    }
  });

  it('follow-up and stories: usable questions; one story per answer, built from the answer', () => {
    expect(toQuestions(scriptedResponse(TASKS['follow-up']()) as FollowUpOutput, id(1)).length).toBeGreaterThanOrEqual(3);
    const stories = toStories(scriptedResponse(TASKS['structure-stories']()) as StoriesOutput, id(2));
    expect(stories).toHaveLength(1);
    expect(stories[0].text).toContain('Online-Shop');
    expect(stories[0].disclosure).toBe('ok');
  });

  it('extract-manual: a vacancy with title, company, city and the literal contact from the pasted text', () => {
    const out = scriptedResponse(TASKS['extract-manual']()) as ManualOutput;
    expect(out.isVacancy).toBe(true);
    const fields = toManualFields(out, PASTED);
    expect(fields).toMatchObject({ title: 'Webentwickler (m/w/d)', company: 'Muster GmbH', locations: ['Hamburg'] });
    expect(fields.contact?.email).toBe('jobs@muster.example');
  });

  it('score: one result for every offer id in the prompt', () => {
    const out = scriptedResponse(TASKS.score()) as ScoreOutput;
    expect(out.results.map((r) => r.id)).toEqual(['aa-1', 'aa-2']);
  });

  it('package tasks: pass the app\'s own letter and CV checks', () => {
    const create = scriptedResponse(TASKS['create-package']()) as CreateOutput;
    expect(checkLetter(create, ctx())).toEqual({ fatal: null, violations: [] });
    expect(checkCv(create, ctx())).toEqual({ fatal: null, violations: [] });
    expect(checkCv(scriptedResponse(TASKS['refresh-cv']()) as CvOutput, ctx('en'))).toEqual({ fatal: null, violations: [] });
    const revised = scriptedResponse(withFeedback(TASKS['revise-letter'](), ['x'])) as LetterOutput;
    expect(checkLetter(revised, ctx())).toEqual({ fatal: null, violations: [] });
  });

  it('offer-reply: names the wanted amount, starts with the salutation, keeps the word limit', () => {
    const { body } = scriptedResponse(TASKS['offer-reply']()) as { body: string };
    expect(offerReplyViolations(body, '55.000 €', ctx())).toEqual([]);
    expect(body.startsWith('Sehr geehrte Damen und Herren,')).toBe(true);
    expect(body).toContain('Max Mustermann');
  });

  it('contact-name: the person from the contact block, accepted by the app check', () => {
    const out = scriptedResponse(TASKS['contact-name']()) as ContactNameOutput;
    expect(out).toEqual({ salutation: 'Frau', name: 'Erika Musterfrau' });
    expect(withContactName(emptyContact(), out, CONTACT_WINDOW).name).toBe('Erika Musterfrau');
    expect(scriptedResponse(contactNameTask('Kontakt\nE-Mail: jobs@muster.example', 'de'))).toEqual({ salutation: '', name: '' });
  });

  it('interview-questions: 9 questions split 4/4/1, accepted by the app check', () => {
    const out = scriptedResponse(TASKS['interview-questions']()) as QuestionsOutput;
    expect(out.questions).toHaveLength(9);
    expect(questionsViolations(out)).toEqual([]);
  });

  it.each([
    ['dontKnow', { text: '', dontKnow: true }, true],
    ['an answer of 19 characters', { text: 'x'.repeat(19), dontKnow: false }, true],
    ['an answer of 20 characters', { text: 'x'.repeat(20), dontKnow: false }, false],
  ])('interview-feedback: %s', (_name, answer, weak) => {
    const out = scriptedResponse(feedbackTask(PREP_CTX(), PREP_QUESTION, answer)) as PrepFeedback;
    expect(out.weak).toBe(weak);
  });

  it.each([[[false, false], 90], [[false, true], 80], [[true, true], 70]] as const)('interview-summary: weak %j gives %i%%', (weak, percent) => {
    const prep = prepWith([...weak]);
    const out = scriptedResponse(summaryTask(PREP_CTX(), prep, null)) as SummaryOutput;
    expect(out.percent).toBe(percent);
    expect(summaryViolations(out, prep)).toEqual([]);
  });
});
