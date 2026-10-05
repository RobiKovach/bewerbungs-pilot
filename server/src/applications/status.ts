import type { ApplicationPackage, ApplicationStatus } from '@bp/shared';
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

/** When the package last changed: the last history entry, else updatedAt. */
export function lastChangeAt(p: ApplicationPackage): string {
  return p.history.at(-1)?.at ?? p.updatedAt;
}
