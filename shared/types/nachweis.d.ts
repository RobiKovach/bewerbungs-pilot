import type { StoredFile } from './profile.js';

/** Bewerbungsnachweis (0.15.0, spec 2026-11-27): who the proof of applications is for — decides the header fields. */
export type NachweisAudience = 'measure' | 'jobcenter' | 'agentur';
/** Own blank forms the app can fill. Only with audience 'measure' (the bbw form has no place for a customer number). */
export type KnownFormId = 'bbw-qgz-pp018';
export type NachweisBlank = { kind: 'standard' } | { kind: 'own'; file: StoredFile; form: KnownFormId };
export interface NachweisSetup {
  audience: NachweisAudience;
  /** Name as printed on the form (prefilled from the profile). */
  personName: string;
  /** audience 'measure'; entry/exit 'YYYY-MM-DD' or ''. */
  measure: { provider: string; name: string; entry: string; exit: string; advisor: string } | null;
  /** audience 'jobcenter' | 'agentur'. */
  office: { name: string; customerNumber: string; advisor: string } | null;
  blank: NachweisBlank;
  updatedAt: string;
}
/** One submitted application the Nachweis can list. appliedAt = first sent/submitted entry (ISO). */
export interface NachweisCandidate { packageId: string; company: string; title: string; appliedAt: string; exportedAt: string | null; contactUnconfirmed: boolean }
/** GET /api/nachweis */
export interface NachweisView { setup: NachweisSetup | null; candidates: NachweisCandidate[] }
