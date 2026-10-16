import type { CvSectionId, EducationEntry, ExperienceEntry, LanguageItem, PersonalData, SkillItem } from './profile.js';
import type { ErrorCode } from './errors.js';
import type { RemoteKind, VacancyContact } from './vacancy.js';
import type { ProviderId } from './settings.js';

export type DocLanguage = 'de' | 'en';
export type ApplicationStatus = 'draft' | 'approved' | 'sent' | 'submitted' | 'interview' | 'rejected' | 'offer' | 'withdrawn';
export type OutcomeStatus = 'interview' | 'rejected' | 'offer' | 'withdrawn';

/** Entries that record something happened but never change the package's status. */
export type HistoryEventKind = 'followUp' | 'followUpDismissed' | 'reply';
export type HistoryKind = ApplicationStatus | HistoryEventKind;
/** One step in a package's life. Entries whose kind is an ApplicationStatus are status entries. */
/** `threadId`: Gmail's conversation id (sent with "Sign in with Google" only) — reminders and replies join it. */
export interface HistoryEntry { kind: HistoryKind; at: string; note?: string; to?: string; messageId?: string; threadId?: string }

/** The person's answer to a job offer, written by Claude and editable (spec, section 9). */
export interface OfferReply { offered: string; wanted: string; body: string; createdAt: string; updatedAt: string }

/** What a reminder/reply dialog starts with. */
export interface MailDraft { to: string; subject: string; body: string; mailReady: boolean }

/** The email as it was sent (kept so the person can read it later). */
export interface SentEmail { to: string; subject: string; body: string; attachments: string[] }

/** The letter in parts (spec, section 2). recipient/salutation/closing/signature are filled by the server, the rest by Claude; the person can edit all of them. */
export interface PackageLetter {
  recipient: string[];
  subject: string;
  salutation: string;
  paragraphs: string[];
  closing: string;
  signature: string;
  /** Stories Claude used (ids from profile.stories at that time). */
  storyIds: string[];
  /** Advice which story would make this letter stronger; null = none. Only shown. */
  hint: string | null;
  /** Pages of the printed letter at the last count; 0 = not counted yet. */
  pages: number;
}

/** What Claude contributes to the CV (spec, decision 3). */
export interface SkillGroup { name: string; skillIds: string[] }
export interface PackageCv {
  profil: string;
  profilEditedByHand: boolean;
  /** CV headline under the name (Claude, per offer); '' = none. */
  headline: string;
  headlineEditedByHand: boolean;
  /** Translated descriptions by entry id (education and experience). */
  descriptions: Record<string, string>;
  /** Skills in groups, groups and skills most relevant first. A v1 package migrates to one unnamed group. */
  skillGroups: SkillGroup[];
  /** Countries and language names in the document language: original value → translation. */
  translations: Record<string, string>;
}

/** The profile as it was when the package was created or its CV last updated. */
export interface PackageSnapshot {
  personal: PersonalData;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  skills: SkillItem[];
  languages: LanguageItem[];
  /** Extension of the photo copied into the package folder; null = no photo. */
  photo: '.jpg' | '.png' | null;
}

export interface PackageVacancy {
  id: string;
  title: string;
  company: string;
  locations: string[];
  remote: RemoteKind;
  contact: VacancyContact | null;
  url: string;
}

export interface ApplicationPackage {
  schemaVersion: 5;
  id: string;
  vacancyId: string;
  language: DocLanguage;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  profileFingerprint: string;
  snapshot: PackageSnapshot;
  vacancy: PackageVacancy;
  letter: PackageLetter;
  cv: PackageCv;
  /** Ids of profile documents chosen for this package. */
  attachments: string[];
  /** Status changes, oldest first. */
  history: HistoryEntry[];
  /** When the email was sent; null = not sent by the app. */
  sentAt: string | null;
  sentEmail: SentEmail | null;
  /** The answer to a job offer; null = none written yet. */
  offerReply: OfferReply | null;
  /** Who wrote the AI parts last (create, "Ask AI", "Update CV", shortening, offer reply). Packages from before 0.8.0: 'claude'. */
  writtenBy: ProviderId;
}

export interface ApplicationSummary {
  id: string;
  vacancyId: string;
  company: string;
  title: string;
  language: DocLanguage;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  writtenBy: ProviderId;
}

export interface ApplicationListView { applications: (ApplicationSummary & { profileChanged: boolean; followUpDue: boolean })[] }

export interface AttachmentInfo {
  id: string;
  label: string;
  size: number;
  selected: boolean;
  /** Chosen for this package but deleted from the profile since. */
  missing: boolean;
}

export interface ApplicationView { application: ApplicationPackage; profileChanged: boolean; attachments: AttachmentInfo[]; canUndo: boolean; followUpDue: boolean }

export interface ApplicationStats {
  sent: number; replies: number; interviews: number; offers: number;
  /** Fractions 0..1 of `sent`; null when nothing was sent yet. */
  rates: { reply: number; interview: number; offer: number } | null;
  /** 8 weeks, oldest first, the current week last; start = local Monday, YYYY-MM-DD. */
  weeks: { start: string; count: number }[];
}

export interface PackageReadiness { ready: boolean; missingSections: CvSectionId[]; noStory: boolean }

/** GET /api/applications/new?vacancyId=… — what the "Create package" dialog needs. */
export interface NewPackageInfo {
  suggestedLanguage: DocLanguage;
  /** The profile's English is below B2 (or not listed). */
  englishBelowB2: boolean;
  /** The offer text is very short (a stub) — the letter will be more general. */
  shortText: boolean;
  /** A package for this vacancy already exists. */
  existingId: string | null;
  readiness: PackageReadiness;
}

export type LetterPatch = Partial<Pick<PackageLetter, 'recipient' | 'subject' | 'salutation' | 'paragraphs' | 'closing' | 'signature'>>;

export type ApplicationJobKind = 'create' | 'recreate' | 'revise' | 'refreshCv';
export type ApplicationJobRunState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

/** GET /api/applications/job. Also stored as applications/job-state.json. */
export interface ApplicationJobState {
  state: ApplicationJobRunState;
  kind: ApplicationJobKind | null;
  vacancyId: string | null;
  /** The package the job works on (for create: set once it is saved). */
  applicationId: string | null;
  error: { code: ErrorCode; detailsForLog: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
}
