import type { SubmittedInfo, Vacancy } from '../types';

export type Tab = 'new' | 'favorite' | 'submitted' | 'stale' | 'hidden';
export const TABS: readonly Tab[] = ['new', 'favorite', 'submitted', 'stale', 'hidden'];
export const WEAK_BELOW = 50;

/** Vacancy id → how and when the person applied (from the applications list; not stored on the vacancy). */
export type SubmittedMap = ReadonlyMap<string, SubmittedInfo>;
const NONE: SubmittedMap = new Map();

/** A vacancy added by hand is never weak: the person chose it, the score is only a hint. */
export const isWeak = (v: Vacancy) => !v.addedManually && v.scoreState === 'scored' && v.score !== null && v.score.value < WEAK_BELOW;

/** Hidden stays hidden; otherwise a vacancy the person applied to leaves New/Favourites/Stale for "Submitted". */
export const tabOf = (v: Pick<Vacancy, 'id' | 'status'>, submitted: SubmittedMap = NONE): Tab => (v.status !== 'hidden' && submitted.has(v.id) ? 'submitted' : v.status);

const rank = (v: Vacancy) => (v.scoreState === 'scored' ? 0 : v.scoreState === 'pending' ? 1 : 2);
function byScore(a: Vacancy, b: Vacancy): number {
  return rank(a) - rank(b)
    || (rank(a) === 0 ? (b.score?.value ?? 0) - (a.score?.value ?? 0) : 0)
    || b.foundAt.localeCompare(a.foundAt);
}
/** New tab: vacancies added by hand first (newest first), then by score. */
const manualFirst = (a: Vacancy, b: Vacancy) => Number(b.addedManually) - Number(a.addedManually)
  || (a.addedManually ? b.foundAt.localeCompare(a.foundAt) : byScore(a, b));

export function tabCounts(list: readonly Vacancy[], submitted: SubmittedMap = NONE): Record<Tab, number> {
  const out: Record<Tab, number> = { new: 0, favorite: 0, submitted: 0, stale: 0, hidden: 0 };
  for (const v of list) out[tabOf(v, submitted)]++;
  return out;
}

export function forTab(list: readonly Vacancy[], tab: Tab, submitted: SubmittedMap = NONE): { main: Vacancy[]; weak: Vacancy[] } {
  const items = list.filter((v) => tabOf(v, submitted) === tab);
  if (tab === 'hidden') return { main: items.sort((a, b) => (b.hiddenAt ?? '').localeCompare(a.hiddenAt ?? '')), weak: [] };
  if (tab === 'submitted') return { main: items.sort((a, b) => (submitted.get(b.id)?.at ?? '').localeCompare(submitted.get(a.id)?.at ?? '')), weak: [] };
  if (tab !== 'new') return { main: items.sort(byScore), weak: [] };
  const sorted = items.sort(manualFirst);
  return { main: sorted.filter((v) => !isWeak(v)), weak: sorted.filter(isWeak) };
}
