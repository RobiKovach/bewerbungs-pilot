import type { ErrorCode } from './errors.js';
import type { EmploymentType } from './profile.js';
import type { Language, ProviderId } from './settings.js';

export type VacancySourceId = 'arbeitsagentur' | 'manual';
/** new → favorite / hidden; new → stale (the source removed it); stale → hidden. See the spec, section 2. */
export type VacancyStatus = 'new' | 'favorite' | 'hidden' | 'stale';
/** pending = waiting for Claude in a running search; notScored = the search stopped before it got there. */
export type ScoreState = 'pending' | 'scored' | 'failed' | 'notScored';
export type RemoteKind = 'yes' | 'partial' | 'no' | 'unknown';
export type Salutation = '' | 'Frau' | 'Herr';
export type PublishedWithinDays = 1 | 3 | 7 | 14 | 30;

/** Only for pasted offers, and only what the pasted text literally contains (checked by code). */
export interface VacancyContact { email: string; salutation: Salutation; name: string }
/**
 * `provider`: the AI helper that scored it (scores from before 0.8.0: 'claude').
 * `language`: the language `why`/`missing` are written in (scores from before 0.8.2: null = not known).
 */
export interface VacancyScore { value: number; why: string[]; missing: string[]; scoredAt: string; provider: ProviderId; language: Language | null }

export interface Vacancy {
  id: string;
  source: VacancySourceId;
  /** Arbeitsagentur "Referenznummer"; null for offers pasted as text. */
  sourceId: string | null;
  /** True for everything the person added by hand (pasted text or an Arbeitsagentur link). */
  addedManually: boolean;
  title: string;
  company: string;
  locations: string[];
  remote: RemoteKind;
  employment: EmploymentType[];
  /** As the source wrote it, never parsed. "" = not stated. */
  salaryText: string;
  /** "YYYY-MM-DD" or "". */
  publishedAt: string;
  foundAt: string;
  /** Where the person can read the original. "" = none. Always http(s). */
  url: string;
  contact: VacancyContact | null;
  /** The full text is in texts/<id>.txt. */
  hasText: boolean;
  status: VacancyStatus;
  scoreState: ScoreState;
  score: VacancyScore | null;
  hiddenAt: string | null;
}

export type SearchRunState = 'idle' | 'running' | 'done' | 'stopped' | 'interrupted' | 'failed';
export type SearchPhase = 'querying' | 'details' | 'scoring' | 'staleCheck';
export type FilterReason = 'seen' | 'notRemote' | 'student' | 'internship' | 'apprenticeship';
export type SearchWarning = 'someQueriesFailed' | 'tooManyQueries' | 'staleCheckFailed';

/** GET /api/vacancies/search. Also stored as search-state.json. */
export interface SearchState {
  state: SearchRunState;
  phase: SearchPhase | null;
  /** Unique offers the source returned (before the filter). */
  found: number;
  filteredOut: Partial<Record<FilterReason, number>>;
  afterFilter: number;
  /** Offers taken into this search (≤ 50) — the "Y" of "scored X of Y". */
  toScore: number;
  scored: number;
  /** New offers left for the next search because of the 50 limit. */
  moreAvailable: number;
  warnings: SearchWarning[];
  error: { code: ErrorCode; detailsForLog: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface VacancyListView { vacancies: Vacancy[] }
/** Answer of every call that changes one card. */
export interface VacancyView { vacancy: Vacancy }
/** "" = no stored text (then the page offers "Load again" for Arbeitsagentur offers). */
export interface VacancyTextView { text: string }
/** POST /api/vacancies/manual. At least one of them. */
export interface ManualInput { text?: string; url?: string }
/** PATCH /api/vacancies/:id — only for source "manual". */
export interface ManualEdit { title: string; company: string; locations: string[]; url: string; contact: VacancyContact | null }
