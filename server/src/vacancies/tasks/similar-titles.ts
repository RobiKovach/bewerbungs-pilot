import type { Language, Profile, SimilarTitle } from '@bp/shared';
import { fenceUntrusted } from '../../llm/fence.js';
import type { JsonSchema, LlmTask } from '../../llm/types.js';
import { LANGUAGE_NAMES } from '../../prompts/languages.js';

/** Proposes further job titles to search for (0.14.0). Only a proposal: the person ticks what is added to the wishes. */
export const SIMILAR_TITLES_MAX = 8;
export const SIMILAR_TITLE_LENGTH = 100;
export const SIMILAR_WHY_LENGTH = 150;

export interface SimilarTitlesOutput { titles: { title: string; why: string }[] }

// Loose on purpose: lengths and count are cut in toSimilarTitles, kinder than failing the answer.
const SCHEMA: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['titles'],
  properties: {
    titles: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['title', 'why'], properties: { title: { type: 'string' }, why: { type: 'string' } } },
    },
  },
};

const RULES = `A job seeker in Germany searches a job board by job title and finds too few offers.
Propose up to ${SIMILAR_TITLES_MAX} FURTHER job titles to search for, the best fitting first.

- "title": a title the way German employers write it in their offers, without "(m/w/d)". One title per entry, 1 to 4 words.
  English only where German offers use the English title (for example "Frontend Developer").
- Only titles whose main requirements the profile below supports. Never a higher level (Senior, Lead), another
  profession or a technology the profile does not name.
- Not a title the person already has in "wishedTitles", also not with only a different ending or "(m/w/d)".
- "why": one short sentence, at most ${SIMILAR_WHY_LENGTH} characters, which facts of the profile fit.
- Fewer titles are better than weak ones; an empty list is fine.`;

/**
 * What the AI helper gets: titles, degrees and skills. No name, contact data, places, dates, employers or free
 * descriptions — they are not needed to find similar titles.
 */
export function similarTitlesInput(profile: Profile): { wishedTitles: string[]; jobsHeld: string[]; degrees: string[]; skills: string[] } {
  const s = profile.sections;
  const clean = (list: string[]) => [...new Set(list.map((x) => x.trim()).filter(Boolean))];
  return {
    wishedTitles: clean(s.wishes.data.jobTitles),
    jobsHeld: clean(s.experience.data.items.map((e) => e.jobTitle)),
    degrees: clean(s.education.data.items.map((e) => e.degree)),
    skills: clean(s.skills.data.items.map((k) => (k.level ? `${k.name.trim()} (${k.level})` : k.name))),
  };
}

export function similarTitlesTask(profile: Profile, language: Language): LlmTask {
  return {
    id: 'similar-titles',
    prompt: [RULES, `The profile:\n${fenceUntrusted('profile', JSON.stringify(similarTitlesInput(profile), null, 1))}`].join('\n\n'),
    schema: SCHEMA,
    replyLanguage: language,
    languageRule: `Write every "title" as German job offers do (see above) and every "why" in ${LANGUAGE_NAMES[language]}.`,
  };
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const withoutGender = (s: string) => oneLine(s.replace(/\(\s*(?:[mwfdx]\s*[/|,]\s*)+[mwfdx]\s*\)/giu, ' '));
/** The same title for the search: case, "(m/w/d)", spaces and hyphens do not matter. */
const titleKey = (s: string) => withoutGender(s).toLowerCase().replace(/[\s-]+/gu, '');

/** The AI's answer checked by code: without wished titles and repeats, cut to the limits. */
export function toSimilarTitles(out: SimilarTitlesOutput, wished: readonly string[]): SimilarTitle[] {
  const seen = new Set(wished.map(titleKey));
  const list: SimilarTitle[] = [];
  for (const t of out.titles) {
    const title = withoutGender(t.title);
    const key = titleKey(title);
    // A cut title would be a wrong search: too long ones are dropped.
    if (!/\p{L}{2,}/u.test(title) || title.length > SIMILAR_TITLE_LENGTH || seen.has(key)) continue;
    seen.add(key);
    list.push({ title, why: oneLine(t.why).slice(0, SIMILAR_WHY_LENGTH) });
    if (list.length === SIMILAR_TITLES_MAX) break;
  }
  return list;
}
