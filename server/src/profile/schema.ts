import type {
  EducationKind, EmploymentType, LanguageLevel, PersonalData, Profile, RemotePreference, Section, SectionDataMap, SectionId,
  SkillLevel, StoryKind,
} from '@bp/shared';
import type { Migration } from '../data/migrate.js';
import type { JsonSchema } from '../llm/types.js';
import { validateOutput } from '../llm/validate.js';

export const PROFILE_SCHEMA_VERSION = 1;
/** migrations[n] turns version n into n + 1. Empty while only version 1 exists; the first change of Profile adds [1]. */
export const PROFILE_MIGRATIONS: Readonly<Record<number, Migration>> = {};

export const SECTION_IDS = ['personal', 'education', 'experience', 'skills', 'languages', 'wishes'] as const satisfies readonly SectionId[];
/** Sections Claude fills from a CV. `wishes` is always the person's own input. */
export const CV_SECTION_IDS = ['personal', 'education', 'experience', 'skills', 'languages'] as const satisfies readonly SectionId[];
export type CvSectionId = (typeof CV_SECTION_IDS)[number];

export const EDUCATION_KINDS = ['school', 'vocational', 'university', 'course', 'certificate'] as const satisfies readonly EducationKind[];
export const SKILL_LEVELS = ['', 'basic', 'good', 'expert'] as const satisfies readonly SkillLevel[];
export const LANGUAGE_LEVELS = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'] as const satisfies readonly LanguageLevel[];
export const REMOTE_PREFERENCES = ['any', 'onsite', 'hybrid', 'remote'] as const satisfies readonly RemotePreference[];
export const EMPLOYMENT_TYPES = ['fulltime', 'parttime', 'minijob', 'apprenticeship', 'internship'] as const satisfies readonly EmploymentType[];
export const STORY_KINDS = ['client', 'work', 'training', 'personal'] as const satisfies readonly StoryKind[];

/** Length/count limits. Claude's output is clipped to the same numbers (tasks/*.ts), so it always fits. */
export const LIMITS = { name: 300, short: 100, text: 5000, question: 1000, entries: 50, skills: 150, lines: 20, stories: 200, neverMention: 50, questions: 10, documents: 20 } as const;
export const PERSONAL_LIMITS = {
  fullName: LIMITS.name, email: LIMITS.name, phone: LIMITS.short, street: LIMITS.name, postalCode: LIMITS.short,
  city: LIMITS.short, country: LIMITS.short, nationality: LIMITS.short, workPermit: LIMITS.name, drivingLicense: LIMITS.short,
} as const satisfies Record<Exclude<keyof PersonalData, 'birthDate'>, number>;

const ID = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' };
const YEAR_MONTH = { type: 'string', pattern: '^(\\d{4}(-(0[1-9]|1[0-2]))?)?$' };
const DAY = { type: 'string', pattern: '^(\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01]))?$' };
const MONTH_OR_DAY = { type: 'string', pattern: '^(\\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\\d|3[01]))?)?$' };
const TIMESTAMP = { type: 'string', maxLength: 40 };
const str = (maxLength: number, minLength = 0): JsonSchema => ({ type: 'string', minLength, maxLength });
const oneOf = (values: readonly (string | number)[]): JsonSchema => ({ enum: [...values] });
const nullable = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: 'null' }] });
const array = (items: JsonSchema, maxItems: number): JsonSchema => ({ type: 'array', maxItems, items });
function obj(properties: Record<string, JsonSchema>): JsonSchema {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}
const items = (item: JsonSchema, maxItems: number) => obj({ items: array(item, maxItems) });

const PERSONAL = obj({
  ...Object.fromEntries(Object.entries(PERSONAL_LIMITS).map(([k, n]) => [k, str(n)])),
  birthDate: DAY,
});
const EDUCATION_ENTRY = obj({
  id: ID, kind: oneOf(EDUCATION_KINDS), degree: str(LIMITS.name), institution: str(LIMITS.name), city: str(LIMITS.short),
  country: str(LIMITS.short), from: YEAR_MONTH, to: YEAR_MONTH, description: str(LIMITS.text),
});
const EXPERIENCE_ENTRY = obj({
  id: ID, jobTitle: str(LIMITS.name), employer: str(LIMITS.name), city: str(LIMITS.short), country: str(LIMITS.short),
  from: YEAR_MONTH, to: YEAR_MONTH, description: str(LIMITS.text),
});
const SKILL = obj({ id: ID, name: str(LIMITS.short), level: oneOf(SKILL_LEVELS) });
const LANGUAGE = obj({ id: ID, language: str(LIMITS.short), level: oneOf(LANGUAGE_LEVELS), certificate: str(LIMITS.name) });
const WISHES = obj({
  jobTitles: array(str(LIMITS.name, 1), LIMITS.lines),
  locations: array(str(LIMITS.short, 1), LIMITS.lines),
  radiusKm: nullable({ type: 'integer', minimum: 0, maximum: 1000 }),
  remote: oneOf(REMOTE_PREFERENCES),
  employmentTypes: { type: 'array', uniqueItems: true, maxItems: EMPLOYMENT_TYPES.length, items: oneOf(EMPLOYMENT_TYPES) },
  salaryMinEur: nullable({ type: 'integer', minimum: 0, maximum: 1_000_000 }),
  availableFrom: MONTH_OR_DAY,
  notes: str(LIMITS.text),
});

export const SECTION_DATA_SCHEMAS: Record<SectionId, JsonSchema> = {
  personal: PERSONAL,
  education: items(EDUCATION_ENTRY, LIMITS.entries),
  experience: items(EXPERIENCE_ENTRY, LIMITS.entries),
  skills: items(SKILL, LIMITS.skills),
  languages: items(LANGUAGE, LIMITS.entries),
  wishes: WISHES,
};

const section = (data: JsonSchema) => obj({ data, aiFields: array(str(LIMITS.name), 5000), confirmedAt: nullable(TIMESTAMP) });
const STORED_FILE_PROPS = {
  id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' },
  ext: oneOf(['.pdf', '.docx', '.jpg', '.png']),
  originalName: str(260, 1),
  size: { type: 'integer', minimum: 0 },
  uploadedAt: TIMESTAMP,
};
const STORED_FILE = obj(STORED_FILE_PROPS);
const DOCUMENT = obj({ ...STORED_FILE_PROPS, label: str(LIMITS.name, 1), attachAlways: { type: 'boolean' } });
const STORY = obj({
  id: ID, title: str(LIMITS.name, 1), text: str(LIMITS.text, 1), kind: oneOf(STORY_KINDS), disclosure: oneOf(['ok', 'never']),
  confirmed: { type: 'boolean' },
});
const QUESTION = obj({ id: ID, question: str(LIMITS.question, 1), why: str(LIMITS.question) });

export const PROFILE_SCHEMA: JsonSchema = obj({
  schemaVersion: { const: PROFILE_SCHEMA_VERSION },
  wizard: obj({ step: oneOf([1, 2, 3, 4]), completedAt: nullable(TIMESTAMP) }),
  cv: nullable(STORED_FILE),
  sections: obj(Object.fromEntries(SECTION_IDS.map((id) => [id, section(SECTION_DATA_SCHEMAS[id])]))),
  stories: array(STORY, LIMITS.stories),
  neverMention: array(str(LIMITS.name, 1), LIMITS.neverMention),
  pendingQuestions: array(QUESTION, LIMITS.questions),
  photo: nullable(STORED_FILE),
  documents: array(DOCUMENT, LIMITS.documents),
});

export function isSectionId(value: string): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value);
}

/** null = valid; otherwise a readable reason (for the log). */
export function validateSectionData(id: SectionId, data: unknown): string | null {
  const r = validateOutput(SECTION_DATA_SCHEMAS[id], data);
  if (!r.ok) return r.errors;
  const list = (data as { items?: { id: string }[] }).items;
  if (list && new Set(list.map((e) => e.id)).size !== list.length) return 'duplicate entry ids';
  return null;
}

export function validateProfile(profile: unknown): string | null {
  const r = validateOutput(PROFILE_SCHEMA, profile);
  if (!r.ok) return r.errors;
  const p = profile as Profile;
  for (const id of SECTION_IDS) {
    const problem = validateSectionData(id, p.sections[id].data);
    if (problem) return `${id}: ${problem}`;
  }
  if (new Set(p.stories.map((s) => s.id)).size !== p.stories.length) return 'duplicate story ids';
  return null;
}

const blank = <T>(data: T): Section<T> => ({ data, aiFields: [], confirmedAt: null });

export function emptySectionData(): SectionDataMap {
  return {
    personal: {
      fullName: '', email: '', phone: '', street: '', postalCode: '', city: '', country: '', birthDate: '',
      nationality: '', workPermit: '', drivingLicense: '',
    },
    education: { items: [] },
    experience: { items: [] },
    skills: { items: [] },
    languages: { items: [] },
    wishes: { jobTitles: [], locations: [], radiusKm: null, remote: 'any', employmentTypes: [], salaryMinEur: null, availableFrom: '', notes: '' },
  };
}

export function emptyProfile(): Profile {
  const d = emptySectionData();
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    wizard: { step: 1, completedAt: null },
    cv: null,
    sections: {
      personal: blank(d.personal), education: blank(d.education), experience: blank(d.experience),
      skills: blank(d.skills), languages: blank(d.languages), wishes: blank(d.wishes),
    },
    stories: [],
    neverMention: [],
    pendingQuestions: [],
    photo: null,
    documents: [],
  };
}
