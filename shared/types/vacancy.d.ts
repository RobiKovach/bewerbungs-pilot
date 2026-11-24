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

/**
 * The employer's contact person. From a pasted text only what it literally contains (checked by code); otherwise
 * what the person saved. phone/street/postcode/city since 0.9.1 ('' = unknown).
 */
export interface VacancyContact { email: string; salutation: Salutation; name: string; phone: string; street: string; postcode: string; city: string }
/** A field of VacancyContact (0.13.0: which fields the app filled in by itself, see Vacancy.contactAuto). */
export type ContactField = keyof VacancyContact;

/** Company research (0.13.0, spec 2026-11-11). queued/running while the research job has it; done/failed after. */
export type ResearchState = 'queued' | 'running' | 'done' | 'failed';
/** A page or news feed the research read; facts and red flags point to one of these by url. */
export interface ResearchSource { url: string; kind: 'vacancy' | 'impressum' | 'contact' | 'apply' | 'careers' | 'about' | 'home' | 'news' }
/** One news item, only as the feed gave it (title, date, source, link); articles are never read. */
export interface ResearchNews { title: string; date: string; source: string; url: string }
/** A fact for the letter or a red flag (never in the letter); always with the url it came from. */
export interface ResearchPoint { id: string; text: string; sourceUrl: string; hidden?: boolean }
export interface CompanyResearch {
  state: ResearchState;
  startedAt: string | null;
  finishedAt: string | null;
  provider: ProviderId | null;
  language: Language | null;
  /** The company website; '' = not found. */
  website: string;
  /** True when the person typed the website (then a new research starts from it). */
  websiteByPerson: boolean;
  about: string;
  news: ResearchNews[];
  /** The news feed could not be read (as opposed to: read, nothing found). */
  newsFailed: boolean;
  /** News were not looked up at all (news off, 0.13.0): no news section is shown. Absent on older research. */
  newsOff?: boolean;
  redFlags: ResearchPoint[];
  facts: ResearchPoint[];
  sources: ResearchSource[];
  error: ErrorCode | null;
}
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
  /** Arbeitsagentur offers: the partner's page about the offer (never an Arbeitsagentur address). Absent/'' = none (0.9.1). */
  partnerUrl?: string;
  /** A favourite the job board has removed meanwhile (0.13.4); absent = not known to be removed. */
  offline?: boolean;
  contact: VacancyContact | null;
  /** The full text is in texts/<id>.txt. */
  hasText: boolean;
  status: VacancyStatus;
  scoreState: ScoreState;
  score: VacancyScore | null;
  hiddenAt: string | null;
  /** Only on cards added by hand: an unsolicited application (Initiativbewerbung). Absent = false (cards before 0.9.0). */
  initiative?: boolean;
  /** Company research (0.13.0). Absent = not researched. */
  research?: CompanyResearch;
  /** Contact fields the app filled in by itself and the person has not confirmed yet (0.13.0). Absent = none. */
  contactAuto?: ContactField[];
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
/** A PDF link in the person's note could not be read / is a scan — the vacancy was added without it (0.9.1). */
export type ManualNotice = 'notePdfUnreadable' | 'notePdfNoText';
/** Answer of POST /api/vacancies/manual: the card, plus notices about the note's PDF links (omitted when none). */
export interface ManualAddView extends VacancyView { notices?: ManualNotice[] }
/** PATCH /api/vacancies/:id — only for source "manual". */
export interface ManualEdit { title: string; company: string; locations: string[]; url: string; contact: VacancyContact | null }

/** Where "find contact" looks (0.9.1 B): the Arbeitsagentur offer in a visible window, or the partner's page. */
export type ContactSource = 'aa' | 'partner';
/** POST /api/vacancies/:id/contact/find. */
export interface ContactFindInput { from: ContactSource }
/** POST /api/vacancies/:id/contact/parse — text the person copied from a page. */
export interface ContactParseInput { text: string }
/** A contact read from a page: only a proposal, nothing is saved. `found` = the fields that are not ''. */
/**
 * `differing` (0.13.0, Ruling R5): values found that differ from fields the card already has filled — never written
 * by itself; the person can take them in the contact window. Absent = none.
 */
export interface ContactProposal { proposal: VacancyContact; found: Array<keyof VacancyContact>; differing?: Partial<VacancyContact> }
/** Answer of …/contact/find: the proposal, or the person closed the window. */
export type ContactFindView = ContactProposal | { cancelled: true };
