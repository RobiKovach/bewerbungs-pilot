import type { EmploymentType, Language, Profile, ProviderId, RemoteKind, VacancyScore } from '@bp/shared';
import { fenceUntrusted } from '../../llm/fence.js';
import type { JsonSchema, LlmTask } from '../../llm/types.js';
import { scoringProfile } from '../profile-context.js';
import { VACANCY_LIMITS } from '../schema.js';

export const SCORE_BATCH = 10;
export const TEXT_FOR_CLAUDE = 6000;

export interface ScoreInput {
  id: string; title: string; company: string; locations: string[]; remote: RemoteKind; employment: EmploymentType[];
  salaryText: string; text: string;
}
export interface ScoreOutput { results: { id: string; score: number; why: string[]; missing: string[] }[] }

const STRINGS = { type: 'array', items: { type: 'string' } };
// Loose on purpose: numbers and lists are clamped/clipped afterwards (toScore), kinder than failing a whole batch.
export const SCORE_FIELDS: Record<string, JsonSchema> = { score: { type: 'number' }, why: STRINGS, missing: STRINGS };
const SCHEMA: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'score', 'why', 'missing'], properties: { id: { type: 'string' }, ...SCORE_FIELDS } },
    },
  },
};

export const SCORING_RULES = `Scale:
- 80–100: strong match — the person meets the main requirements and the offer fits their wishes.
- 50–79: partial match — worth a look, some requirements or wishes do not fit.
- 0–49: weak match.
Rules:
- Judge ONLY by the profile and the offer text. Never invent facts about the person or the offer.
- A requirement the offer does not state is not a minus.
- Compare required language levels with the person's levels, and the job level (Junior/Senior/Lead) with their experience.
- Salary: if the offer states one and it is below the person's salaryMinEur, that is a minus and a "missing" point.
  If it states none, salary does not count.
- An offer that does not fit the wished remote setting or employment type is a minus.
- "why": 1–3 short points why it fits. "missing": 0–3 short points what is missing or does not fit.
  Write them in the reply language; keep names of technologies, tools and job titles as in the original.
- If an offer text is very short (for example only a link to another website), judge by what is there and say so in "missing".`;

const RULES = `You compare job offers with a job seeker's profile for a job-application assistant.
For EVERY offer below return one result with its exact id.

${SCORING_RULES}`;

export function scoreTask(items: readonly ScoreInput[], profile: Profile, language: Language): LlmTask {
  const offers = items.map((it) => {
    const { text, id, ...meta } = it;
    return `Offer id: ${id}\n${fenceUntrusted('vacancy', `${JSON.stringify(meta)}\n\n${text.slice(0, TEXT_FOR_CLAUDE)}`)}`;
  });
  return {
    prompt: [RULES, `The person's profile:\n${fenceUntrusted('profile', JSON.stringify(scoringProfile(profile), null, 1))}`, ...offers].join('\n\n'),
    schema: SCHEMA,
    replyLanguage: language,
  };
}

const clip = (list: string[]) =>
  list.map((s) => s.trim().slice(0, VACANCY_LIMITS.point)).filter(Boolean).slice(0, VACANCY_LIMITS.points);

/** `provider`: the AI helper that actually answered (LlmQueue.runTagged); `language`: the reply language the task asked for. */
export function toScore(raw: { score: number; why: string[]; missing: string[] }, at: string, provider: ProviderId, language: Language): VacancyScore {
  const value = Math.min(100, Math.max(0, Math.round(Number.isFinite(raw.score) ? raw.score : 0)));
  return { value, why: clip(raw.why), missing: clip(raw.missing), scoredAt: at, provider, language };
}

export function toScores(out: ScoreOutput, ids: readonly string[], at: string, provider: ProviderId, language: Language): Map<string, VacancyScore> {
  const wanted = new Set(ids);
  const scores = new Map<string, VacancyScore>();
  for (const r of out.results) {
    if (wanted.has(r.id) && !scores.has(r.id)) scores.set(r.id, toScore(r, at, provider, language));
  }
  return scores;
}
