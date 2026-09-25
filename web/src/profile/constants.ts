import type { CvSectionId, EducationKind, EmploymentType, LanguageLevel, RemotePreference, SectionId, SkillLevel, StoryKind } from '../types';

// Same values as server/src/profile/schema.ts and files.ts. The server checks everything again; these only let the
// page give early, friendly feedback.
export const SECTION_IDS = ['personal', 'education', 'experience', 'skills', 'languages', 'wishes'] as const satisfies readonly SectionId[];
/** Sections Claude fills from a CV, in page order. */
export const CV_SECTION_IDS = ['personal', 'education', 'experience', 'skills', 'languages'] as const satisfies readonly CvSectionId[];
export const EDUCATION_KINDS = ['school', 'vocational', 'university', 'course', 'certificate'] as const satisfies readonly EducationKind[];
export const SKILL_LEVELS = ['', 'basic', 'good', 'expert'] as const satisfies readonly SkillLevel[];
export const LANGUAGE_LEVELS = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const satisfies readonly LanguageLevel[];
export const REMOTE_PREFERENCES = ['any', 'onsite', 'hybrid', 'remote'] as const satisfies readonly RemotePreference[];
export const EMPLOYMENT_TYPES = ['fulltime', 'parttime', 'minijob', 'apprenticeship', 'internship'] as const satisfies readonly EmploymentType[];
export const STORY_KINDS = ['client', 'work', 'training', 'personal'] as const satisfies readonly StoryKind[];

const MB = 1024 * 1024;
export const MAX_BYTES = { cv: 10 * MB, photo: 5 * MB, document: 10 * MB } as const;
export const MAX_DOCUMENTS = 20;
/** Subset of the server's LIMITS (schema.ts) that a person can hit while typing. */
export const LIMITS = { name: 300, text: 5000, lines: 20, neverMention: 50 } as const;
