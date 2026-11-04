import { describe, it, expect } from 'vitest';
import type { InterviewPrep, PrepQuestion } from '@bp/shared';
import { packageContext } from '../src/applications/tasks/context.js';
import {
  feedbackTask, questionsTask, questionsViolations, summaryTask, summaryViolations,
  type QuestionsOutput, type SummaryOutput, type TaskCtx,
} from '../src/interview/tasks.js';
import { PREP_LIMITS } from '../src/interview/schema.js';
import { strictProblems } from '../src/llm/codex-cli.js';
import { composePrompt } from '../src/prompts/languages.js';
import { validateOutput } from '../src/llm/validate.js';
import { pkg, readyPackageProfile } from './helpers/applications.js';

const profile = () => readyPackageProfile((p) => { p.neverMention = ['Lücke 2020']; });
const taskCtx = (over: Partial<TaskCtx> = {}, initiative = false): TaskCtx => ({
  ctx: packageContext(profile(), 'de', false, initiative), pkg: pkg(), vacancyText: 'Wir suchen einen Webentwickler mit React.',
  language: 'de', uiLanguage: 'uk', ...over,
});
const question = (over: Partial<PrepQuestion> = {}): PrepQuestion => ({ id: 'q1', kind: 'theory', text: 'Was ist React?', code: null, answer: null, ...over });
const prep = (): InterviewPrep => ({
  schemaVersion: 1, applicationId: 'app-1', language: 'de', createdAt: '2026-11-04T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z', employerQuestions: [], summary: null,
  questions: [question({ answer: { text: 'GEHEIME-ANTWORT', dontKnow: false, updatedAt: '2026-11-04T10:00:00.000Z', feedback: { weak: true, content: 'c', languageFixes: [], better: 'b' } } })],
});
const set = (e: number, t: number, p: number, employer = 3): QuestionsOutput => ({
  questions: [
    ...Array.from({ length: e }, () => ({ kind: 'experience' as const, text: 'Erfahrung?', code: null })),
    ...Array.from({ length: t }, () => ({ kind: 'theory' as const, text: 'Theorie?', code: null })),
    ...Array.from({ length: p }, () => ({ kind: 'practice' as const, text: 'Praxis?', code: null })),
  ],
  employerQuestions: Array.from({ length: employer }, () => 'Wie sieht das Team aus?'),
});
const summary = (questionId: string): SummaryOutput => ({ percent: 60, areas: { experience: 'a', theory: 'b', practice: 'c', language: 'd' }, biggestRisk: { questionId, why: 'w' } });
/** The prompt with its fenced data blocks taken out. */
const outsideFences = (prompt: string) => prompt.replace(/^<<<(UNTRUSTED_\w+)>>>\n[\s\S]*?\n<<<END_\1>>>$/gm, '');

describe('questionsViolations', () => {
  it('accepts 4 experience, 4 theory, 1 practice and 3 questions for the employer', () => {
    expect(questionsViolations(set(4, 4, 1))).toEqual([]);
  });
  it('reports another split', () => {
    expect(questionsViolations(set(5, 3, 1)).length).toBeGreaterThan(0);
  });
  it('reports 2 questions for the employer', () => {
    expect(questionsViolations(set(4, 4, 1, 2)).length).toBeGreaterThan(0);
  });
  it('reports blank texts', () => {
    const out = set(4, 4, 1);
    out.questions[0].text = '   ';
    out.employerQuestions[0] = ' ';
    expect(questionsViolations(out)).toHaveLength(2);
  });
});

describe('summaryViolations', () => {
  it('accepts a risk from the set', () => {
    expect(summaryViolations(summary('q1'), prep())).toEqual([]);
  });
  it('reports an unknown question id', () => {
    expect(summaryViolations(summary('q99'), prep()).length).toBeGreaterThan(0);
  });
});

describe('questionsTask', () => {
  it('without a job ad: builds from the letter and the profile', () => {
    const task = questionsTask(taskCtx({ vacancyText: '' }, true));
    expect(task.prompt).toContain('No job ad text is available');
    expect(task.prompt).toContain('Absatz eins.');
  });
  it('asks in the interview language and keeps the fixed split', () => {
    const task = questionsTask(taskCtx({ language: 'en', uiLanguage: 'uk' }));
    expect(task.replyLanguage).toBe('en');
    expect(task.prompt).toContain('exactly 4 "experience", 4 "theory" and 1 "practice"');
  });
  it('limits questions on never-mention topics to one and gives the list', () => {
    const task = questionsTask(taskCtx());
    expect(task.prompt).toContain('At most ONE question');
    expect(task.prompt).toContain('Lücke 2020');
  });
  it('experience questions do not presuppose experience the person lacks', () => {
    expect(questionsTask(taskCtx()).prompt).toContain('Never presuppose experience that is absent from the profile and the letter');
  });
  it('the job ad, the letter and the profile are fenced', () => {
    const outside = outsideFences(questionsTask(taskCtx()).prompt);
    for (const text of ['Wir suchen einen Webentwickler', 'Absatz eins.', 'Lücke 2020']) expect(outside).not.toContain(text);
  });
  it('a long AI answer fails at the AI step, with the same limits as the store', () => {
    const { schema } = questionsTask(taskCtx());
    const out = set(4, 4, 1);
    out.questions[0].text = 'x'.repeat(PREP_LIMITS.question + 1);
    expect(validateOutput(schema, out).ok).toBe(false);
    const code = set(4, 4, 1);
    code.questions[8].code = 'x'.repeat(PREP_LIMITS.code + 1);
    expect(validateOutput(schema, code).ok).toBe(false);
    expect(validateOutput(schema, set(4, 4, 1)).ok).toBe(true);
  });
});

describe('feedbackTask', () => {
  it('the answer stands only inside its fence', () => {
    const task = feedbackTask(taskCtx(), question(), { text: 'GEHEIME-ANTWORT', dontKnow: false });
    expect(task.prompt).toContain('GEHEIME-ANTWORT');
    expect(outsideFences(task.prompt)).not.toContain('GEHEIME-ANTWORT');
  });
  it('carries the rules: no invented experience, weak, never-mention, no flattery', () => {
    const { prompt } = feedbackTask(taskCtx(), question(), { text: 'Antwort', dontKnow: false });
    for (const rule of ['Never invent', 'smaller language mistakes alone do not make it weak', 'directly asks about it', 'No flattery', 'said in this answer']) expect(prompt).toContain(rule);
  });
  it('claims about the person stay limited, while theory and practice get correct professional content', () => {
    const { prompt } = feedbackTask(taskCtx(), question(), { text: 'Antwort', dontKnow: false });
    expect(prompt).toContain('Every claim about the person (experience, projects, employers, skills, numbers) comes only from the profile');
    expect(prompt).toContain('For a question of kind "experience": if the person has no such experience, give an honest answer');
    expect(prompt).toContain('For a question of kind "theory" or "practice": give the correct professional content even if it is not in the profile');
    expect(prompt).toContain('correct professional content for "theory" and "practice", an honest answer for "experience"');
  });
  it('never-mention topics are limited in "content" too', () => {
    expect(feedbackTask(taskCtx(), question(), { text: 'Antwort', dontKnow: false }).prompt).toContain('use one in "content" or "better" only when');
  });
  it('without a job ad: no instruction to build questions', () => {
    const { prompt } = feedbackTask(taskCtx({ vacancyText: '' }), question(), { text: 'Antwort', dontKnow: false });
    expect(prompt).toContain('No job ad text is available.');
    expect(prompt).not.toContain('Build the questions');
  });
  it('"I don\'t know" is always weak and shows what to say', () => {
    expect(feedbackTask(taskCtx(), question(), { text: '', dontKnow: true }).prompt).toContain('The person pressed "I don\'t know"');
  });
  it('languages: explanations in the app language, German phrases in the interview language, no contradicting last line', () => {
    const composed = composePrompt(feedbackTask(taskCtx(), question(), { text: 'Antwort', dontKnow: false }));
    expect(composed).not.toContain('Write all natural-language text');
    expect(composed).toContain('Write "content" and every "why" in Ukrainian');
    expect(composed).toContain('Write every "said", "correct" and "better" in German');
  });
  it('the code of a practical task reaches the AI', () => {
    expect(feedbackTask(taskCtx(), question({ kind: 'practice', code: 'return a + b;' }), { text: 'Antwort', dontKnow: false }).prompt).toContain('return a + b;');
  });
  it('a long AI answer fails at the AI step', () => {
    const { schema } = feedbackTask(taskCtx(), question(), { text: 'Antwort', dontKnow: false });
    const good = { weak: false, content: 'gut', languageFixes: [], better: 'besser' };
    expect(validateOutput(schema, good).ok).toBe(true);
    expect(validateOutput(schema, { ...good, better: 'x'.repeat(PREP_LIMITS.feedback + 1) }).ok).toBe(false);
  });
});

describe('summaryTask', () => {
  it('gives the previous figure only when there is one', () => {
    expect(summaryTask(taskCtx(), prep(), 55).prompt).toContain('The previous figure was 55%');
    expect(summaryTask(taskCtx(), prep(), null).prompt).not.toContain('The previous figure');
  });
  it('answers are fenced; explanations in the app language', () => {
    const task = summaryTask(taskCtx(), prep(), null);
    expect(outsideFences(task.prompt)).not.toContain('GEHEIME-ANTWORT');
    expect(task.prompt).toContain('GEHEIME-ANTWORT');
    expect(task.replyLanguage).toBe('uk');
  });
  it('without a job ad: no instruction to build questions', () => {
    const { prompt } = summaryTask(taskCtx({ vacancyText: '' }), prep(), null);
    expect(prompt).toContain('No job ad text is available.');
    expect(prompt).not.toContain('Build the questions');
  });
  it('leaves out the never-mention list', () => {
    expect(summaryTask(taskCtx(), prep(), null).prompt).not.toContain('Lücke 2020');
  });
  it('a figure outside 0–100 fails at the AI step', () => {
    const { schema } = summaryTask(taskCtx(), prep(), null);
    expect(validateOutput(schema, summary('q1')).ok).toBe(true);
    expect(validateOutput(schema, { ...summary('q1'), percent: 101 }).ok).toBe(false);
  });
});

describe('all three tasks', () => {
  const tasks = () => [
    questionsTask(taskCtx()),
    feedbackTask(taskCtx(), question(), { text: 'Antwort', dontKnow: false }),
    summaryTask(taskCtx(), prep(), null),
  ];
  it('hold no contact data of the person', () => {
    const { fullName, email, phone } = profile().sections.personal.data;
    expect(fullName && email && phone).toBeTruthy();
    for (const t of tasks()) for (const secret of [fullName, email, phone]) expect(t.prompt).not.toContain(secret);
  });
  it('have schemas valid for OpenAI strict structured outputs', () => {
    for (const t of tasks()) expect(strictProblems(t.schema)).toEqual([]);
  });
});
