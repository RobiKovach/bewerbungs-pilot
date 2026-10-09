import type { ApplicationPackage, ApplicationStatus, HistoryEventKind } from '@bp/shared';
import { AppError } from '../errors.js';

/** A package in any of these statuses was sent: it is never changed or sent again. */
export const FROZEN: ReadonlySet<ApplicationStatus> = new Set<ApplicationStatus>(['sent', 'submitted', 'interview', 'rejected', 'offer', 'withdrawn']);

export function isFrozen(p: ApplicationPackage): boolean {
  return FROZEN.has(p.status);
}

export function assertEditable(p: ApplicationPackage): void {
  if (isFrozen(p)) throw new AppError('CONFLICT', 'package was sent', 'packageSent');
}

/** Appends a history entry and makes it the package's status. */
export function addStatus(p: ApplicationPackage, kind: ApplicationStatus, at: string, extra: { note?: string; to?: string; messageId?: string } = {}): void {
  p.history.push({ kind, at, ...extra });
  p.status = kind;
  p.updatedAt = at;
}

const STATUSES: ReadonlySet<string> = new Set<ApplicationStatus>(['draft', 'approved', 'sent', 'submitted', 'interview', 'rejected', 'offer', 'withdrawn']);

/** True for the history kinds that are statuses (not events like a reminder). */
export function isStatusKind(kind: string): kind is ApplicationStatus {
  return STATUSES.has(kind);
}

/** Appends an event to the history; the status stays as it is. */
export function addEvent(p: ApplicationPackage, kind: HistoryEventKind, at: string, extra: { to?: string; messageId?: string } = {}): void {
  p.history.push({ kind, at, ...extra });
  p.updatedAt = at;
}

/** The last change can be taken back unless it is a real sent email (that can never be undone). */
export function canUndo(p: ApplicationPackage): boolean {
  const last = p.history.at(-1);
  return isFrozen(p) && last !== undefined && last.kind !== 'sent' && !last.messageId;
}

/** Removes the last history entry; the status becomes the kind of the last remaining status entry ('approved' if none). */
export function undoLast(p: ApplicationPackage, now: string): void {
  p.history.pop();
  const lastStatus = [...p.history].reverse().find((h) => isStatusKind(h.kind));
  p.status = lastStatus && isStatusKind(lastStatus.kind) ? lastStatus.kind : 'approved';
  p.updatedAt = now;
}

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' → that day at 12:00 UTC (ISO). Throws BAD_REQUEST for an invalid date or one more than 365 days after `now`. */
export function dateToIso(date: string, now: Date): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new AppError('BAD_REQUEST', 'date must be YYYY-MM-DD');
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, da, 12));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== da) throw new AppError('BAD_REQUEST', 'date does not exist');
  if (t.getTime() - now.getTime() > 365 * DAY_MS) throw new AppError('BAD_REQUEST', 'date is too far in the future');
  return t.toISOString();
}
