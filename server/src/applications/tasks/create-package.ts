import type { PackageVacancy } from '@bp/shared';
import { fenceUntrusted } from '../../llm/fence.js';
import type { JsonSchema, LlmTask } from '../../llm/types.js';
import type { PackageContext } from './context.js';

export const OFFER_FOR_CLAUDE = 8000;
const STRINGS: JsonSchema = { type: 'array', items: { type: 'string' } };
export const LETTER_FIELDS: Record<string, JsonSchema> = {
  subject: { type: 'string' }, paragraphs: STRINGS, storyIds: STRINGS, hint: { anyOf: [{ type: 'string' }, { type: 'null' }] },
};
const PAIRS: JsonSchema = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } } };
export const CV_FIELDS: Record<string, JsonSchema> = {
  profil: { type: 'string' },
  headline: { type: 'string' },
  descriptions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' } } } },
  skillGroups: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'skillIds'], properties: { name: { type: 'string' }, skillIds: STRINGS } } },
  translations: PAIRS,
};
export const objectOf = (fields: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', additionalProperties: false, required: Object.keys(fields), properties: fields });

const LANGUAGE_NAME = { de: 'German', en: 'English' } as const;

/** Letter rules shared by create and revise (spec, section 3 and the product spec's "Anschreiben ≠ copy of the CV"). */
export function letterRules(ctx: PackageContext): string {
  const lang = LANGUAGE_NAME[ctx.language];
  return `Letter rules:
- Write the subject and every paragraph in ${lang}${ctx.language === 'de' ? ' (formal Sie-form)' : ''}. Keep official names (job titles, employers, schools, degrees, technologies) exactly as written.
- 3 or 4 paragraphs, together about 200–300 words, so that the letter fits on one A4 page.
- The letter complements the CV, it never repeats it. Tell 1–2 TRUE stories from "stories" and return their ids in "storyIds". Tie each story to a concrete requirement or task of the offer ("You are looking for X — at Y I did Z").
- Never list skills or technologies, never restate job titles with dates, no generic soft-skill claims without a story behind them. A technology may appear only inside a story where it was really used, and only if the offer asks for it.
- Never invent facts. Use only the profile, the stories and the offer.
- Paragraph 1: why this role and company, with 1–2 concrete details from the offer. Middle: the stories. Last paragraph: what the person would concretely bring, and interest in a personal interview.
- "subject" is only the subject line, e.g. "${ctx.language === 'de' ? 'Bewerbung als' : 'Application for'} <job title>". Do NOT write the address, date, salutation, closing formula or name — the app adds them.
- Never mention job centres (Jobcenter), unemployment benefits or job-seeker programmes (Maßnahme).
- Write only about strengths. Never mention gaps, missing skills, weaknesses or what the person still has to learn, not even as an honest admission ("Although I have no experience with X…"). If a requirement is not met, simply leave it out.
- Never mention language skills or language levels (German, English or any other) — they are in the CV.
- Never mention anything from "neverMention", not even paraphrased.${ctx.mentionHomeOffice ? `
- The job is not in the person's city. Say in one natural sentence that the person lives in ${ctx.city} and would work from Home Office. Never offer to relocate or to be on site regularly.` : ''}
- "hint": if no story fits a main requirement of the offer well, one short sentence saying which kind of story would make this letter stronger; otherwise null.`;
}

export function cvRules(ctx: PackageContext): string {
  const lang = LANGUAGE_NAME[ctx.language];
  return `CV rules:
- "profil": 2–3 sentences in ${lang} for the top of the CV, only from facts in the profile, focused on what matters for this offer. No invented facts, no clichés.
- "descriptions": for EVERY education and experience entry with a non-empty description, return { id, text } with the description translated into ${lang}. Translate only — add nothing, drop nothing important. Entries with an empty description are left out.
- "headline": the job title shown under the name, in ${lang}, at most 80 characters, fitting this offer but ONLY from facts in the profile (job titles held, education, the person's wished job titles ("jobTitles")). Never claim a title or seniority the person never had. Example: "Webentwickler / WordPress".
- "skillGroups": 3–5 groups (1–2 if the profile has fewer than 6 skills) with short names in ${lang} (e.g. "Web", "Tools", "KI & Entwicklung"). Put EVERY skill id from the profile into exactly one group. Groups most relevant to the offer first, and inside a group the most relevant skills first.
- "translations": for EVERY value in "toTranslate" return { from, to } with "from" copied exactly and "to" in ${lang} (countries and language names, e.g. "Україна" → "Ukraine", "Німецька" → "${ctx.language === 'de' ? 'Deutsch' : 'German'}"). A value already in ${lang} is returned unchanged. Nothing else.`;
}

export function contextBlock(ctx: PackageContext): string {
  const data = {
    city: ctx.city, education: ctx.education, experience: ctx.experience, skills: ctx.skills,
    languages: ctx.languages, jobTitles: ctx.jobTitles, stories: ctx.stories, neverMention: ctx.neverMention, toTranslate: ctx.toTranslate,
  };
  return `The person's profile and stories:\n${fenceUntrusted('profile', JSON.stringify(data, null, 1))}`;
}

export function offerBlock(vacancy: PackageVacancy, offerText: string): string {
  const meta = { title: vacancy.title, company: vacancy.company, locations: vacancy.locations, remote: vacancy.remote };
  return `The job offer:\n${fenceUntrusted('vacancy', `${JSON.stringify(meta)}\n\n${offerText.slice(0, OFFER_FOR_CLAUDE)}`)}`;
}

export function createPackageTask(ctx: PackageContext, vacancy: PackageVacancy, offerText: string): LlmTask {
  return {
    id: 'create-package',
    prompt: [
      'You write a cover letter (Anschreiben) and the tailored parts of a CV (Lebenslauf) for one job application in Germany.',
      letterRules(ctx), cvRules(ctx), contextBlock(ctx), offerBlock(vacancy, offerText),
    ].join('\n\n'),
    schema: objectOf({ ...LETTER_FIELDS, ...CV_FIELDS }),
    replyLanguage: ctx.language,
  };
}
