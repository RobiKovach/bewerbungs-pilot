import type { WishesData } from '../types';

/** Same rule as the server's assertWishesComplete: a job title and a place (or "remote only"). */
export function wishesComplete(w: WishesData): boolean {
  return w.jobTitles.some((t) => t.trim()) && (w.locations.some((l) => l.trim()) || w.remote === 'remote');
}
