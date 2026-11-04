import type { ApplicationPackage, InterviewPrep, Language, PrepFeedback, PrepKind, PrepQuestion } from '@bp/shared';
import type { PackageContext } from '../applications/tasks/context.js';
import { OFFER_FOR_CLAUDE } from '../applications/tasks/create-package.js';
import { fenceUntrusted } from '../llm/fence.js';
import type { JsonSchema, LlmTask } from '../llm/types.js';
import { positionTitle } from '../mail/compose.js';
import { LANGUAGE_NAMES } from '../prompts/languages.js';
import { PREP_LIMITS as L } from './schema.js';

export interface TaskCtx { ctx: PackageContext; pkg: ApplicationPackage; vacancyText: string; language: 'de' | 'en'; uiLanguage: Language }
export interface QuestionsOutput { questions: { kind: PrepKind; text: string; code: string | null }[]; employerQuestions: string[] }
export type FeedbackOutput = PrepFeedback;
export interface SummaryOutput {
  percent: number;
  areas: { experience: string; theory: string; practice: string; language: string };
  biggestRisk: { questionId: string; why: string };
}

/** One set: spec, section 5.2. */
export const PREP_SET: Readonly<Record<PrepKind, number>> = { experience: 4, theory: 4, practice: 1 };
export const EMPLOYER_QUESTIONS = 3;

const text = (maxLength: number): JsonSchema => ({ type: 'string', minLength: 1, maxLength });
const objectOf = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

const QUESTIONS_SCHEMA = objectOf({
  questions: {
    type: 'array', maxItems: L.questions,
    items: objectOf({ kind: { type: 'string', enum: ['experience', 'theory', 'practice'] }, text: text(L.question), code: { anyOf: [text(L.code), { type: 'null' }] } }),
  },
  employerQuestions: { type: 'array', maxItems: L.employerQuestions, items: text(L.question) },
});
const FEEDBACK_SCHEMA = objectOf({
  weak: { type: 'boolean' },
  content: text(L.feedback),
  languageFixes: { type: 'array', maxItems: L.fixes, items: objectOf({ said: text(L.fix), correct: text(L.fix), why: text(L.fix) }) },
  better: text(L.feedback),
});
const SUMMARY_SCHEMA = objectOf({
  percent: { type: 'integer', minimum: 0, maximum: 100 },
  areas: objectOf({ experience: text(L.area), theory: text(L.area), practice: text(L.area), language: text(L.area) }),
  biggestRisk: objectOf({ questionId: { type: 'string', minLength: 1, maxLength: 64 }, why: text(L.area) }),
});

/** Everything the AI may know about the person: PackageContext already holds no contact data. */
function factBlocks({ ctx, pkg }: TaskCtx, withNeverMention = true): string[] {
  const facts = { experience: ctx.experience, education: ctx.education, skills: ctx.skills.map((s) => s.name), languages: ctx.languages, stories: ctx.stories };
  // Only what the employer read about the person: never recipient, salutation or signature.
  const letter = { subject: pkg.letter.subject, paragraphs: pkg.letter.paragraphs };
  return [
    `The person's profile:\n${fenceUntrusted('profile', JSON.stringify(facts, null, 1))}`,
    `The letter the employer received:\n${fenceUntrusted('letter', JSON.stringify(letter, null, 1))}`,
    ...(withNeverMention && ctx.neverMention.length ? [`The person's "never mention" list:\n${fenceUntrusted('never mention', JSON.stringify(ctx.neverMention))}`] : []),
  ];
}

function offerBlock({ ctx, pkg, vacancyText }: TaskCtx, ifNoAd = ''): string {
  const position = { position: positionTitle(pkg), company: pkg.vacancy.company };
  const offer = vacancyText.trim().slice(0, OFFER_FOR_CLAUDE);
  const note = ctx.initiative ? ' This is an unsolicited application: the company has not advertised a position, so never refer to a job ad.' : '';
  return [
    `The position:\n${fenceUntrusted('position', JSON.stringify(position))}`,
    offer ? `The job ad:\n${fenceUntrusted('vacancy', offer)}${note}` : `No job ad text is available.${ifNoAd}${note}`,
  ].join('\n\n');
}

export function questionsTask(c: TaskCtx): LlmTask {
  const name = LANGUAGE_NAMES[c.language];
  return {
    id: 'interview-questions',
    prompt: [
      'You prepare a person for a job interview. Predict the questions this employer is most likely to ask about this position. Return { "questions": [...], "employerQuestions": [...] }.',
      `Rules:
- Write everything in ${name}, the language of the interview${c.language === 'de' ? ' (formal Sie-form)' : ''}.
- Return exactly ${PREP_SET.experience} "experience", ${PREP_SET.theory} "theory" and ${PREP_SET.practice} "practice" questions, in that order, like the questions asked in a real interview.
- "experience": about the person's own path and work; these may refer to what the letter says, because the employer will ask about it. Never presuppose experience that is absent from the profile and the letter: ask openly instead of naming a project, employer or skill the person does not have.
- "theory": professional knowledge this position really needs. This is not always programming: for a warehouse job it is warehouse knowledge.
- "practice": one small work situation or task that can be solved by talking. Put a short code fragment into "code" only for a technical position, otherwise "code" is null. Every other question has "code": null.
- At most ONE question in the set may touch a topic from the "never mention" list, because an employer can raise such a topic unprompted. Hard and uncomfortable questions are welcome: they happen in real interviews.
- Do not answer the questions and give no hints.
- "employerQuestions": exactly ${EMPLOYER_QUESTIONS} good questions the person can ask the employer about this position.`,
      offerBlock(c, " Build the questions from the position, the letter and the person's profile."),
      ...factBlocks(c),
    ].join('\n\n'),
    schema: QUESTIONS_SCHEMA,
    replyLanguage: c.language,
  };
}

export function feedbackTask(c: TaskCtx, q: PrepQuestion, answer: { text: string; dontKnow: boolean }): LlmTask {
  const interview = LANGUAGE_NAMES[c.language];
  const ui = LANGUAGE_NAMES[c.uiLanguage];
  return {
    id: 'interview-feedback',
    prompt: [
      'You give honest feedback on one spoken answer in a practice job interview. Return { "weak", "content", "languageFixes", "better" }.',
      `Rules:
- "weak": true when the content is weak or the language is hard to understand; smaller language mistakes alone do not make it weak.
- "content": what is weak in the content and what was missing. If the content is good, say briefly why. A low language level never lowers what is expected of the content.
- "languageFixes": each language mistake as "said" → "correct", with a short "why". This is a spoken answer, not a letter. It may have come through speech recognition: an obviously garbled word is not a language mistake. Empty list when there are no mistakes.
- "better": a short, ready-to-say answer. Every claim about the person (experience, projects, employers, skills, numbers) comes only from the profile, the letter and what the person said in this answer. Never invent such claims.
- For a question of kind "experience": if the person has no such experience, give an honest answer that says so and names what is close to it.
- For a question of kind "theory" or "practice": give the correct professional content even if it is not in the profile, phrased as knowledge and without claiming experience the person lacks.
- "never mention" topics: use one in "content" or "better" only when the question directly asks about it, and then keep it short and honest, or when the person brought it up in this answer.
- Criticise the answer, never the person. No flattery: do not call a weak answer good.
- The person pressed "I don't know" when the block below says dontKnow: true. Then "weak" is true, "languageFixes" is empty, and "content" and "better" show what would have been good to say, by the same rules: correct professional content for "theory" and "practice", an honest answer for "experience".`,
      `The question:\n${fenceUntrusted('question', JSON.stringify({ kind: q.kind, text: q.text, code: q.code }, null, 1))}`,
      `The person's answer:\n${fenceUntrusted('answer', JSON.stringify(answer))}`,
      offerBlock(c),
      ...factBlocks(c),
    ].join('\n\n'),
    schema: FEEDBACK_SCHEMA,
    replyLanguage: c.uiLanguage,
    languageRule: `Write "content" and every "why" in ${ui}. Write every "said", "correct" and "better" in ${interview}, the language of the interview.`,
  };
}

export function summaryTask(c: TaskCtx, prep: InterviewPrep, previousPercent: number | null): LlmTask {
  const answers = prep.questions.map((q) => ({
    id: q.id, kind: q.kind, question: q.text, answer: q.answer?.text ?? '', dontKnow: q.answer?.dontKnow ?? false, weak: q.answer?.feedback?.weak ?? true,
    languageFixes: q.answer?.feedback?.languageFixes.length ?? 0,
  }));
  return {
    id: 'interview-summary',
    prompt: [
      'You judge how a person did in a practice job interview. Return { "percent", "areas", "biggestRisk" }.',
      `Rules:
- "percent": the chance from 0 to 100 that this person passes this interview, judged ONLY from the answers below. You know neither the other candidates nor the employer's decision. Be honest and do not round in the person's favour: "I don't know" and weak answers lower it.
- "areas": one or two honest sentences each on "experience", "theory", "practice" and "language", naming what you saw in the answers.
- "biggestRisk": the id of the one question to repeat first ("questionId", from the block below) and why ("why").${previousPercent === null ? '' : `
- The previous figure was ${previousPercent}%. The app asks again only because answers changed: move away from it only as far as the answers justify.`}`,
      `The answers:\n${fenceUntrusted('answers', JSON.stringify(answers, null, 1))}`,
      offerBlock(c),
      ...factBlocks(c, false),
    ].join('\n\n'),
    schema: SUMMARY_SCHEMA,
    replyLanguage: c.uiLanguage,
  };
}

/** What the schema cannot say; goes back to the AI once (withFeedback), then LLM_BAD_OUTPUT. */
export function questionsViolations(out: QuestionsOutput): string[] {
  const problems: string[] = [];
  for (const kind of Object.keys(PREP_SET) as PrepKind[]) {
    const n = out.questions.filter((q) => q.kind === kind).length;
    if (n !== PREP_SET[kind]) problems.push(`Return exactly ${PREP_SET[kind]} "${kind}" questions, not ${n}.`);
  }
  if (out.employerQuestions.length !== EMPLOYER_QUESTIONS) problems.push(`Return exactly ${EMPLOYER_QUESTIONS} "employerQuestions", not ${out.employerQuestions.length}.`);
  if (out.questions.some((q) => !q.text.trim())) problems.push('Every question needs a text.');
  if (out.employerQuestions.some((q) => !q.trim())) problems.push('Every question for the employer needs a text.');
  return problems;
}

export function summaryViolations(out: SummaryOutput, prep: InterviewPrep): string[] {
  return prep.questions.some((q) => q.id === out.biggestRisk.questionId) ? [] : ['"biggestRisk.questionId" must be the id of a question from the block.'];
}
