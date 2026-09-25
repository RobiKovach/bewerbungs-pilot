export type SectionId = 'personal' | 'education' | 'experience' | 'skills' | 'languages' | 'wishes';

/** "YYYY", "YYYY-MM" or "" (unknown). In `to`, "" means "until now". */
export type YearMonth = string;

export interface PersonalData {
  fullName: string;
  email: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  /** "YYYY-MM-DD" or "". */
  birthDate: string;
  nationality: string;
  /** Free text, e.g. "EU citizen" or "Aufenthaltstitel § 24". */
  workPermit: string;
  drivingLicense: string;
}

export type EducationKind = 'school' | 'vocational' | 'university' | 'course' | 'certificate';

// Official names (degree, institution, jobTitle, employer, certificate) are copied exactly as written and are never
// translated; `description` is free text in the person's own language.
export interface EducationEntry {
  id: string;
  kind: EducationKind;
  degree: string;
  institution: string;
  city: string;
  country: string;
  from: YearMonth;
  to: YearMonth;
  description: string;
}

export interface ExperienceEntry {
  id: string;
  jobTitle: string;
  employer: string;
  city: string;
  country: string;
  from: YearMonth;
  to: YearMonth;
  description: string;
}

export type SkillLevel = '' | 'basic' | 'good' | 'expert';
export interface SkillItem { id: string; name: string; level: SkillLevel }

export type LanguageLevel = '' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'native';
export interface LanguageItem { id: string; language: string; level: LanguageLevel; certificate: string }

export type RemotePreference = 'any' | 'onsite' | 'hybrid' | 'remote';
export type EmploymentType = 'fulltime' | 'parttime' | 'minijob' | 'apprenticeship' | 'internship';

export interface WishesData {
  jobTitles: string[];
  locations: string[];
  radiusKm: number | null;
  remote: RemotePreference;
  employmentTypes: EmploymentType[];
  salaryMinEur: number | null;
  /** "YYYY-MM", "YYYY-MM-DD" or "". */
  availableFrom: string;
  notes: string;
}

export interface SectionDataMap {
  personal: PersonalData;
  education: { items: EducationEntry[] };
  experience: { items: ExperienceEntry[] };
  skills: { items: SkillItem[] };
  languages: { items: LanguageItem[] };
  wishes: WishesData;
}

/**
 * aiFields: paths of fields Claude filled that the person has not checked yet, e.g. "fullName",
 * "items.<entryId>.jobTitle", "jobTitles". confirmedAt: when the person clicked "All correct" (null = not checked).
 * editedAt: when the person last saved a change to the section since it was (re)filled from a CV (null = no change of
 * theirs in it — also after deleting nothing and changing nothing). A section with confirmedAt or editedAt set is the
 * person's work: a new CV never overwrites it, it only proposes (Profile.cvProposals).
 */
export interface Section<T> { data: T; aiFields: string[]; confirmedAt: string | null; editedAt: string | null }
export type Sections = { [K in SectionId]: Section<SectionDataMap[K]> };

/** Sections Claude fills from a CV (`wishes` is always the person's own input). */
export type CvSectionId = Exclude<SectionId, 'wishes'>;
/**
 * What a newly uploaded CV says for a section the person already checked or edited. It is kept aside, never applied on
 * its own: the person takes it ("Take the new version") or drops it ("Keep mine").
 */
export type CvProposals = { [K in CvSectionId]?: SectionDataMap[K] };

export type StoryKind = 'client' | 'work' | 'training' | 'personal';
export interface Story {
  id: string;
  title: string;
  text: string;
  kind: StoryKind;
  /** 'never' = true, but must never be told to an employer (e.g. a client under NDA). */
  disclosure: 'ok' | 'never';
  confirmed: boolean;
}
export type StoryInput = Omit<Story, 'id' | 'confirmed'>;
export interface StoryAnswer { questionId: string; answer: string }
export interface FollowUpQuestion { id: string; question: string; why: string }

export type FileExt = '.pdf' | '.docx' | '.jpg' | '.png';
export interface StoredFile { id: string; ext: FileExt; originalName: string; size: number; uploadedAt: string }
export interface ProfileDocument extends StoredFile { label: string; attachAlways: boolean }

export interface Profile {
  schemaVersion: 2;
  wizard: { step: 1 | 2 | 3 | 4; completedAt: string | null };
  cv: StoredFile | null;
  sections: Sections;
  stories: Story[];
  neverMention: string[];
  /** Questions Claude asked that were not turned into stories yet. */
  pendingQuestions: FollowUpQuestion[];
  photo: StoredFile | null;
  documents: ProfileDocument[];
  cvProposals: CvProposals;
}

export type ReadinessWarning = 'noStories';
export interface Readiness { ready: boolean; missing: SectionId[]; warnings: ReadinessWarning[] }
export interface ProfileView { profile: Profile; readiness: Readiness }
/**
 * Answer of POST /api/profile/cv. changedSections: replaced by the new CV (the person had not worked on them yet; their
 * confirmation was reset). proposedSections: the person had worked on them, so they stay as they are and the new CV's
 * version waits in profile.cvProposals for the person's choice.
 */
export interface CvResult extends ProfileView { changedSections: CvSectionId[]; proposedSections: CvSectionId[] }
