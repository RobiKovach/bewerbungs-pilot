import type {
  CvSectionId, EducationKind, EmploymentType, LanguageLevel, PersonalData, Profile, RemotePreference, Section, SectionDataMap, SectionId,
  SkillLevel, StoryKind,
} from '@bp/shared';
import type { Migration } from '../data/migrate.js';
import type { JsonSchema } from '../llm/types.js';
import { validateOutput } from '../llm/validate.js';
import { filledPaths } from './sections.js';

export const PROFILE_SCHEMA_VERSION = 4;
/** migrations[n] turns version n into n + 1. */
export const PROFILE_MIGRATIONS: Readonly<Record<number, Migration>> = {
  // 2: open CV proposals (none in old files) and Section.editedAt (see migrateEditedAt).
  1: (doc) => ({ ...doc, cvProposals: {}, sections: migrateEditedAt(doc.sections, new Date().toISOString()) }),
  // 3: job wishes get the Zeitarbeit switch, on (= the search behaves as it would have before).
  2: (doc) => ({ ...doc, sections: withWishesDefault(doc.sections) }),
  // 4: personal details get a list of links (none in old files).
  3: (doc) => ({ ...doc, sections: withLinksDefault(doc.sections), cvProposals: withProposalLinksDefault(doc.cvProposals) }),
};

/** An open "replace CV" proposal for personal details gets the same default; anything malformed is left alone. */
function withProposalLinksDefault(proposals: unknown): unknown {
  const p = proposals as { personal?: unknown } | null;
  if (!p || typeof p !== 'object' || !p.personal || typeof p.personal !== 'object') return proposals;
  return { ...p, personal: { links: [], ...(p.personal as object) } };
}

function withLinksDefault(sections: unknown): unknown {
  const s = sections as { personal?: { data?: unknown } } | null;
  if (!s || typeof s !== 'object' || !s.personal || typeof s.personal.data !== 'object' || s.personal.data === null) return sections;
  return { ...s, personal: { ...s.personal, data: { links: [], ...(s.personal.data as object) } } };
}

/** A malformed document is left alone for validateProfile to refuse. */
function withWishesDefault(sections: unknown): unknown {
  const s = sections as { wishes?: { data?: unknown } } | null;
  if (!s || typeof s !== 'object' || !s.wishes || typeof s.wishes.data !== 'object' || s.wishes.data === null) return sections;
  return { ...s, wishes: { ...s.wishes, data: { includeTemporaryAgencies: true, ...(s.wishes.data as object) } } };
}

/**
 * Version 1 did not record edits. The best we can tell afterwards: in a CV section, a filled field without an AI mark
 * was typed or changed by the person, so the section counts as edited (as of the update). Job wishes never come from a
 * CV (their defaults, like remote "any", are not marks) and start with null. A version 1 deletion or cleared field left
 * no trace and cannot be recovered; a malformed section is left alone for validateProfile to refuse.
 */
function migrateEditedAt(sections: unknown, at: string): unknown {
  if (!sections || typeof sections !== 'object') return sections;
  return Object.fromEntries(Object.entries(sections as Record<string, unknown>).map(([id, raw]) => {
    const s = raw as { data?: unknown; aiFields?: unknown };
    if (!s || typeof s !== 'object' || !Array.isArray(s.aiFields)) return [id, raw];
    const marked = new Set(s.aiFields);
    const edited = isCvSectionId(id) && filledPaths(s.data).some((p) => !marked.has(p));
    return [id, { ...s, editedAt: edited ? at : null }];
  }));
}

export const SECTION_IDS = ['personal', 'education', 'experience', 'skills', 'languages', 'wishes'] as const satisfies readonly SectionId[];
/** Sections Claude fills from a CV. `wishes` is always the person's own input. */
export const CV_SECTION_IDS = ['personal', 'education', 'experience', 'skills', 'languages'] as const satisfies readonly CvSectionId[];
export type { CvSectionId };

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
} as const satisfies Record<Exclude<keyof PersonalData, 'birthDate' | 'links'>, number>;
export const LINK_LIMITS = { count: 3, label: 40, url: 300 } as const;
export const LINK_URL = /^https?:\/\/\S+$/;

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

const LINK = obj({ label: str(LINK_LIMITS.label, 1), url: { type: 'string', minLength: 1, maxLength: LINK_LIMITS.url, pattern: LINK_URL.source } });
const PERSONAL = obj({
  ...Object.fromEntries(Object.entries(PERSONAL_LIMITS).map(([k, n]) => [k, str(n)])),
  birthDate: DAY,
  links: array(LINK, LINK_LIMITS.count),
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
  includeTemporaryAgencies: { type: 'boolean' },
});

export const SECTION_DATA_SCHEMAS: Record<SectionId, JsonSchema> = {
  personal: PERSONAL,
  education: items(EDUCATION_ENTRY, LIMITS.entries),
  experience: items(EXPERIENCE_ENTRY, LIMITS.entries),
  skills: items(SKILL, LIMITS.skills),
  languages: items(LANGUAGE, LIMITS.entries),
  wishes: WISHES,
};

const section = (data: JsonSchema) => obj({
  data, aiFields: array(str(LIMITS.name), 5000), confirmedAt: nullable(TIMESTAMP), editedAt: nullable(TIMESTAMP),
});
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
  // At most one per CV section; each is checked like the section itself in validateProfile.
  cvProposals: { type: 'object', additionalProperties: false, properties: Object.fromEntries(CV_SECTION_IDS.map((id) => [id, {}])) },
});

export function isSectionId(value: string): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value);
}

export function isCvSectionId(value: string): value is CvSectionId {
  return (CV_SECTION_IDS as readonly string[]).includes(value);
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
  for (const id of CV_SECTION_IDS) {
    const proposal = p.cvProposals[id];
    const problem = proposal === undefined ? null : validateSectionData(id, proposal);
    if (problem) return `cvProposals.${id}: ${problem}`;
  }
  if (new Set(p.stories.map((s) => s.id)).size !== p.stories.length) return 'duplicate story ids';
  return null;
}

const blank = <T>(data: T): Section<T> => ({ data, aiFields: [], confirmedAt: null, editedAt: null });

export function emptySectionData(): SectionDataMap {
  return {
    personal: {
      fullName: '', email: '', phone: '', street: '', postalCode: '', city: '', country: '', birthDate: '',
      nationality: '', workPermit: '', drivingLicense: '', links: [],
    },
    education: { items: [] },
    experience: { items: [] },
    skills: { items: [] },
    languages: { items: [] },
    wishes: {
      jobTitles: [], locations: [], radiusKm: null, remote: 'any', employmentTypes: [], salaryMinEur: null, availableFrom: '', notes: '',
      includeTemporaryAgencies: true,
    },
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
    cvProposals: {},
  };
}
