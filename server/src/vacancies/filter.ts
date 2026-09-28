import type { FilterReason, Profile, Vacancy } from '@bp/shared';
import { findDuplicate, pairKey } from './dedup.js';
import type { SourceHit } from './sources/types.js';

export interface Rejected { hit: SourceHit; reason: FilterReason }
export interface FilterResult { passed: SourceHit[]; rejected: Rejected[] }

/** A whole word, also next to umlauts (JS \b only knows ASCII letters). */
const word = (source: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu');
const STUDENT = word('werkstudent(?:in|en|innen)?|werkstudierende[rn]?|studentische[rn]? (?:hilfskraft|aushilfe|mitarbeit(?:er|erin)?)|abschlussarbeit|bachelorarbeit|masterarbeit|thesis');
const INTERNSHIP = word('praktikum|pflichtpraktikum|praktikant(?:in|en|innen)?|praxissemester|internship|intern');
// Bare "Ausbildung" names the offer kind ("Ausbildung zum Fachinformatiker"), but the same word also shows up as a
// qualification a non-apprenticeship job wants ("abgeschlossene Ausbildung", "Ausbildung wünschenswert") — exclude
// that reading by checking the word immediately before/after it.
const APPRENTICESHIP_QUALIFIER_BEFORE = 'abgeschlossen(?:e[rn]?)?|mit|nach|oder|bzw\\.?';
const APPRENTICESHIP_QUALIFIER_AFTER = 'wünschenswert|erforderlich|vorausgesetzt|von\\s+vorteil';
const APPRENTICESHIP = word(
  'ausbildungsplatz|auszubildende[rn]?|azubi|duales studium|duale[rs]? student(?:in)?'
  + `|(?<!(?:${APPRENTICESHIP_QUALIFIER_BEFORE})\\s)ausbildung(?!\\s+(?:${APPRENTICESHIP_QUALIFIER_AFTER}))`,
);

/** Currently studying = a university entry without an end date. */
export function isStudent(profile: Profile): boolean {
  return profile.sections.education.data.items.some((e) => e.kind === 'university' && e.to === '');
}

/**
 * Cheap checks before Claude sees anything (spec, section 4). It leaves level, languages, salary and skills to Claude on
 * purpose: those are easy to get wrong with rules and would drop good offers.
 */
export function filterHits(hits: readonly SourceHit[], profile: Profile, existing: readonly Vacancy[]): FilterResult {
  const wishes = profile.sections.wishes.data;
  const student = isStudent(profile);
  const passed: SourceHit[] = [];
  const rejected: Rejected[] = [];
  const seenPairs = new Set<string>();
  const seenIds = new Set<string>();

  const reasonFor = (h: SourceHit): FilterReason | null => {
    const key = pairKey(h.company, h.title);
    if (seenIds.has(h.sourceId) || (key !== null && seenPairs.has(key)) || findDuplicate(existing, h)) return 'seen';
    if (wishes.remote === 'remote' && h.remote !== 'yes' && h.remote !== 'partial') return 'notRemote';
    if (!student && STUDENT.test(h.title)) return 'student';
    if (!wishes.employmentTypes.includes('internship') && INTERNSHIP.test(h.title)) return 'internship';
    if (!wishes.employmentTypes.includes('apprenticeship') && APPRENTICESHIP.test(h.title)) return 'apprenticeship';
    return null;
  };

  for (const h of hits) {
    const reason = reasonFor(h);
    // Remember every hit, also rejected ones: a second copy of it is "seen", not re-judged.
    seenIds.add(h.sourceId);
    const key = pairKey(h.company, h.title);
    if (key !== null) seenPairs.add(key);
    if (reason) rejected.push({ hit: h, reason });
    else passed.push(h);
  }
  return { passed, rejected };
}
