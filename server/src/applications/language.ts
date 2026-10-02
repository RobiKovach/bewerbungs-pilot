import type { DocLanguage, LanguageItem } from '@bp/shared';

const DE_WORDS = new Set(['und', 'die', 'der', 'das', 'wir', 'sie', 'ihr', 'ihre', 'mit', 'für', 'bei', 'eine', 'einen', 'ist', 'auf', 'zu', 'von', 'bieten', 'suchen']);
const EN_WORDS = new Set(['and', 'the', 'we', 'you', 'your', 'with', 'for', 'our', 'are', 'is', 'to', 'of', 'will', 'offer', 'looking', 'join']);

/** A cheap guess from common words (spec, self-review 1). German wins ties: the market is Germany. */
export function detectLanguage(text: string): DocLanguage {
  let de = 0;
  let en = 0;
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (DE_WORDS.has(word)) de++;
    if (EN_WORDS.has(word)) en++;
  }
  return en > de ? 'en' : 'de';
}

const ENGLISH = /engl|англ|angiel|ingl/i;
const B2_OR_BETTER = new Set(['B2', 'C1', 'C2', 'native']);

/** True when the profile lists no English at B2 or better (spec, decision 7: warning when English is chosen). */
export function englishBelowB2(languages: LanguageItem[]): boolean {
  return !languages.some((l) => ENGLISH.test(l.language) && B2_OR_BETTER.has(l.level));
}
