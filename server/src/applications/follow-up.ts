import type { ApplicationPackage } from '@bp/shared';

export const FOLLOW_UP_DAYS = 14;
const DAY_MS = 86_400_000;

/** Sent or submitted, and neither a reminder nor "do not remind" yet (one reminder per package). */
export function followUpOpen(p: ApplicationPackage): boolean {
  return (p.status === 'sent' || p.status === 'submitted') && !p.history.some((h) => h.kind === 'followUp' || h.kind === 'followUpDismissed');
}

/** Spec, section 8: 14 days after sending/submitting with nothing new in the history. */
export function followUpDue(p: ApplicationPackage, now: Date): boolean {
  if (!followUpOpen(p)) return false;
  const last = p.history.at(-1);
  if (!last || last.kind !== p.status) return false;
  return now.getTime() - Date.parse(last.at) >= FOLLOW_UP_DAYS * DAY_MS;
}
