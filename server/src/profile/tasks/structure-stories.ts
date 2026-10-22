import type { Language, Story, StoryInput } from '@bp/shared';
import { fenceUntrusted } from '../../llm/fence.js';
import type { LlmTask } from '../../llm/types.js';
import { LIMITS, STORY_KINDS } from '../schema.js';

export interface StoriesOutput { stories: StoryInput[] }
export interface AnsweredQuestion { question: string; answer: string }

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['stories'],
  properties: {
    stories: {
      type: 'array', maxItems: 15,
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'text', 'kind', 'disclosure'],
        properties: {
          title: { type: 'string', minLength: 1 }, text: { type: 'string', minLength: 1 },
          kind: { enum: [...STORY_KINDS] }, disclosure: { enum: ['ok', 'never'] },
        },
      },
    },
  },
};

const RULES = `Turn a job seeker's answers into short stories for their story bank. Their cover letters will later be
built from these stories, so they must be true.

- Use only what the answers say. Never invent details, numbers, clients, results or feelings.
- One story per distinct experience; an answer can give zero, one or several stories.
- title: a few words. text: 2–6 sentences in the first person, in the reply language.
- kind: "client" (work done for a client or customer), "work" (at an employer), "training" (school, course,
  apprenticeship, studies), "personal" (own project or life experience).
- disclosure: "never" if the person says it must not be told to employers or it is confidential (e.g. a client under
  an NDA), otherwise "ok".
- Never mention anything from the "never mention" list in any title or text.`;

export function structureStoriesTask(answers: AnsweredQuestion[], neverMention: string[], language: Language): LlmTask {
  const prompt = [
    RULES,
    `Answers:\n${fenceUntrusted('answers', JSON.stringify(answers, null, 1))}`,
    `Never mention:\n${fenceUntrusted('never mention', JSON.stringify(neverMention))}`,
  ].join('\n\n');
  return { id: 'structure-stories', prompt, schema: SCHEMA, replyLanguage: language };
}

export function toStories(out: StoriesOutput, newId: () => string): Story[] {
  return out.stories
    .map((s) => ({ title: s.title.trim().slice(0, LIMITS.name), text: s.text.trim().slice(0, LIMITS.text), kind: s.kind, disclosure: s.disclosure }))
    .filter((s) => s.title && s.text)
    .map((s) => ({ id: newId(), ...s, confirmed: false }));
}
