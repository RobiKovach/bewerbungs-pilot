import type { JsonSchema } from '../llm/types.js';
import { validateOutput } from '../llm/validate.js';
import { LIMITS, validateSectionData } from '../profile/schema.js';
import { VACANCY_LIMITS } from '../vacancies/schema.js';

export const APPLICATIONS_SCHEMA_VERSION = 1;
export const PACKAGE_SCHEMA_VERSION = 1;
export const APPLICATION_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Letter fields that copy vacancy or profile data are never tighter than their source, so a valid vacancy/profile
// cannot fail saving after Claude has written the letter.
export const PACKAGE_LIMITS = {
  recipientLines: 6, line: Math.max(200, VACANCY_LIMITS.company, VACANCY_LIMITS.name),
  subject: VACANCY_LIMITS.title + 100, salutation: VACANCY_LIMITS.name + 100,
  paragraphsMin: 1, paragraphsMax: 6, paragraph: 2000,
  closing: 100, signature: Math.max(200, LIMITS.name), hint: 300, profil: 800, description: 5000, instruction: 1000, attachments: 20,
} as const;

const L = PACKAGE_LIMITS;
const V = VACANCY_LIMITS;
const str = (maxLength: number): JsonSchema => ({ type: 'string', maxLength });
const nullable = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: 'null' }] });
function obj(properties: Record<string, JsonSchema>): JsonSchema {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}
const ID = { type: 'string', pattern: APPLICATION_ID.source };
const TIMESTAMP = str(40);
const LANGUAGE = { enum: ['de', 'en'] };
const STATUS = { enum: ['draft', 'approved'] };

const SUMMARY = obj({
  id: ID, vacancyId: ID, company: str(V.company), title: str(V.title), language: LANGUAGE, status: STATUS,
  createdAt: TIMESTAMP, updatedAt: TIMESTAMP, approvedAt: nullable(TIMESTAMP),
});

const PACKAGE = obj({
  schemaVersion: { const: PACKAGE_SCHEMA_VERSION },
  id: ID, vacancyId: ID, language: LANGUAGE, status: STATUS, createdAt: TIMESTAMP, updatedAt: TIMESTAMP, approvedAt: nullable(TIMESTAMP),
  profileFingerprint: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  // Section data is checked with the profile's own section validators below.
  snapshot: obj({
    personal: { type: 'object' }, education: { type: 'array' }, experience: { type: 'array' }, skills: { type: 'array' }, languages: { type: 'array' },
    photo: { enum: ['.jpg', '.png', null] },
  }),
  vacancy: obj({
    id: ID, title: str(V.title), company: str(V.company), locations: { type: 'array', maxItems: V.locations, items: str(V.location) },
    remote: { enum: ['yes', 'partial', 'no', 'unknown'] },
    contact: nullable(obj({ email: str(V.email), salutation: { enum: ['', 'Frau', 'Herr'] }, name: str(V.name) })),
    url: { type: 'string', maxLength: V.url, pattern: '^(https?://.+)?$' },
  }),
  letter: obj({
    recipient: { type: 'array', maxItems: L.recipientLines, items: str(L.line) },
    subject: str(L.subject), salutation: str(L.salutation),
    paragraphs: { type: 'array', minItems: L.paragraphsMin, maxItems: L.paragraphsMax, items: str(L.paragraph) },
    closing: str(L.closing), signature: str(L.signature),
    storyIds: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 64 } },
    hint: nullable(str(L.hint)), pages: { type: 'integer', minimum: 0, maximum: 99 },
  }),
  cv: obj({
    profil: str(L.profil), profilEditedByHand: { type: 'boolean' },
    descriptions: { type: 'object', maxProperties: 100, additionalProperties: str(L.description) },
    skillOrder: { type: 'array', maxItems: 150, items: { type: 'string', maxLength: 64 } },
  }),
  attachments: { type: 'array', maxItems: L.attachments, uniqueItems: true, items: { type: 'string', maxLength: 64 } },
});

const LIST = obj({ schemaVersion: { const: APPLICATIONS_SCHEMA_VERSION }, applications: { type: 'array', items: SUMMARY } });

/** null = valid; otherwise a readable reason (for the log, after forLog()). */
export function validatePackage(doc: unknown): string | null {
  const r = validateOutput(PACKAGE, doc);
  if (!r.ok) return r.errors;
  const s = (doc as { snapshot: Record<string, unknown> }).snapshot;
  return validateSectionData('personal', s.personal)
    ?? validateSectionData('education', { items: s.education })
    ?? validateSectionData('experience', { items: s.experience })
    ?? validateSectionData('skills', { items: s.skills })
    ?? validateSectionData('languages', { items: s.languages });
}

export function validateList(doc: unknown): string | null {
  const r = validateOutput(LIST, doc);
  return r.ok ? null : r.errors;
}

/** validateOutput() ends with a JSON echo of the document — never for a log (see vacancies/store.ts). */
export function forLog(problem: string): string {
  return problem.replace(/ \(got .*\)$/s, '').slice(0, 500);
}
