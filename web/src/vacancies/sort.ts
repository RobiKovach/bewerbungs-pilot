import type { Vacancy } from '../types';

export type Tab = 'new' | 'favorite' | 'stale' | 'hidden';
export const TABS: readonly Tab[] = ['new', 'favorite', 'stale', 'hidden'];
export const WEAK_BELOW = 50;

export const isWeak = (v: Vacancy) => v.scoreState === 'scored' && v.score !== null && v.score.value < WEAK_BELOW;

const rank = (v: Vacancy) => (v.scoreState === 'scored' ? 0 : v.scoreState === 'pending' ? 1 : 2);
function byScore(a: Vacancy, b: Vacancy): number {
  return rank(a) - rank(b)
    || (rank(a) === 0 ? (b.score?.value ?? 0) - (a.score?.value ?? 0) : 0)
    || b.foundAt.localeCompare(a.foundAt);
}

export function tabCounts(list: readonly Vacancy[]): Record<Tab, number> {
  const out: Record<Tab, number> = { new: 0, favorite: 0, stale: 0, hidden: 0 };
  for (const v of list) out[v.status]++;
  return out;
}

export function forTab(list: readonly Vacancy[], tab: Tab): { main: Vacancy[]; weak: Vacancy[] } {
  const items = list.filter((v) => v.status === tab);
  if (tab === 'hidden') return { main: items.sort((a, b) => (b.hiddenAt ?? '').localeCompare(a.hiddenAt ?? '')), weak: [] };
  const sorted = items.sort(byScore);
  if (tab !== 'new') return { main: sorted, weak: [] };
  return { main: sorted.filter((v) => !isWeak(v)), weak: sorted.filter(isWeak) };
}
