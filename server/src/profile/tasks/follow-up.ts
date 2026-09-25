import type { FollowUpQuestion, Language, Profile } from '@bp/shared';
import { fenceUntrusted } from '../../llm/fence.js';
import type { LlmTask } from '../../llm/types.js';
import { LIMITS, SECTION_IDS } from '../schema.js';

export interface FollowUpOutput { questions: { question: string; why: string }[] }

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['questions'],
  properties: {
    questions: {
      type: 'array', minItems: 3, maxItems: 7,
      items: {
        type: 'object', additionalProperties: false, required: ['question', 'why'],
        properties: { question: { type: 'string', minLength: 1 }, why: { type: 'string' } },
      },
    },
  },
};

const RULES = `You help a job seeker build a bank of true, concrete stories for cover letters (Anschreiben).
A good cover letter does not repeat the CV. It tells one or two concrete stories: what the person did, for whom,
what came out of it, what they are proud of.

Based on the profile below, ask 3 to 7 short, personal follow-up questions that bring out such stories. Where they fit,
cover: a concrete project or task and for whom it was (a client, an employer, a school or course); what the person is
proud of; how they came to this profession or how they learned it; responsibility they carried; personal projects;
and whether anything must never be mentioned to employers (for example a client's name).

- Do not ask about facts that are already in the profile, and do not repeat topics of the existing stories.
- One question per item, plain everyday words, no jargon.
- "why": one short sentence that tells the person why this question helps their applications.`;

const noIds = (_key: string, value: unknown) => (_key === 'id' ? undefined : value);

/**
 * Sections the questions are built from. `personal` (name, address, phone, e-mail, birth date) is left
 * out on purpose: the questions are about work and stories, and none of them needs contact details.
 */
const QUESTION_SECTION_IDS = SECTION_IDS.filter((id) => id !== 'personal');

export function followUpTask(profile: Profile, language: Language): LlmTask {
  const context = JSON.stringify({
    profile: Object.fromEntries(QUESTION_SECTION_IDS.map((id) => [id, profile.sections[id].data])),
    existingStories: profile.stories.map((s) => s.title),
    neverMention: profile.neverMention,
  }, noIds, 1);
  return { prompt: `${RULES}\n\n${fenceUntrusted('profile', context)}`, schema: SCHEMA, replyLanguage: language };
}

export function toQuestions(out: FollowUpOutput, newId: () => string): FollowUpQuestion[] {
  return out.questions
    .map((q) => ({ id: newId(), question: q.question.trim().slice(0, LIMITS.question), why: q.why.trim().slice(0, LIMITS.question) }))
    .filter((q) => q.question)
    .slice(0, 7);
}
