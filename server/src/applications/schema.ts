import type { JsonSchema } from '../llm/types.js';
import { validateOutput } from '../llm/validate.js';
import type { Migration } from '../data/migrate.js';
import { PROVIDER_IDS } from '../data/settings.js';
import { LIMITS, validateSectionData } from '../profile/schema.js';
import { VACANCY_LIMITS } from '../vacancies/schema.js';

export const APPLICATIONS_SCHEMA_VERSION = 2;
export const PACKAGE_SCHEMA_VERSION = 5;

/** migrations[n] turns package version n into n + 1 (applied on read; written back on the next save). */
export const PACKAGE_MIGRATIONS: Readonly<Record<number, Migration>> = {
  // 5: who wrote the package (Claude was the only AI before 0.8.0).
  4: (doc) => ({ ...doc, writtenBy: 'claude' }),
  // 4: the answer to a job offer; history may hold events (reminders, replies).
  3: (doc) => ({ ...doc, offerReply: null }),
  // 3: statuses beyond approved, history, the sent email.
  2: (doc) => ({
    ...doc,
    history: doc.status === 'approved' && typeof doc.approvedAt === 'string' ? [{ kind: 'approved', at: doc.approvedAt }] : [],
    sentAt: null,
    sentEmail: null,
  }),
  // 2: CV headline, skill groups instead of a flat order, translations; snapshot personal details get links.
  1: (doc) => {
    const cv = (doc.cv ?? {}) as Record<string, unknown>;
    const { skillOrder, ...rest } = cv;
    const snapshot = (doc.snapshot ?? {}) as Record<string, unknown>;
    const personal = (snapshot.personal ?? {}) as Record<string, unknown>;
    return {
      ...doc,
      cv: { ...rest, headline: '', headlineEditedByHand: false, skillGroups: [{ name: '', skillIds: Array.isArray(skillOrder) ? skillOrder : [] }], translations: {} },
      snapshot: { ...snapshot, personal: { links: [], ...personal } },
    };
  },
};
/** migrations[n] turns applications.json version n into n + 1. */
export const LIST_MIGRATIONS: Readonly<Record<number, Migration>> = {
  // 2: summaries say who wrote the package (Claude was the only AI before 0.8.0).
  1: (doc) => ({
    ...doc,
    applications: Array.isArray(doc.applications) ? doc.applications.map((s) => ({ writtenBy: 'claude', ...(s as object) })) : [],
  }),
};
export const APPLICATION_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Letter fields that copy vacancy or profile data are never tighter than their source, so a valid vacancy/profile
// cannot fail saving after Claude has written the letter.
export const PACKAGE_LIMITS = {
  recipientLines: 6, line: Math.max(200, VACANCY_LIMITS.company, VACANCY_LIMITS.name),
  subject: VACANCY_LIMITS.title + 100, salutation: VACANCY_LIMITS.name + 100,
  paragraphsMin: 1, paragraphsMax: 6, paragraph: 2000,
  closing: 100, signature: Math.max(200, LIMITS.name), hint: 300, profil: 800, description: 5000, instruction: 1000, attachments: 20,
  headline: 80, groupName: 40, translation: 100, groupsMax: 5,
  emailSubject: 200, emailBody: 5000, note: 300, address: 254, history: 200, fileName: 200, messageId: 300, offerField: 50, offerBody: 3000,
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
const STATUS = { enum: ['draft', 'approved', 'sent', 'submitted', 'interview', 'rejected', 'offer', 'withdrawn'] };
const PROVIDER = { enum: [...PROVIDER_IDS] };
const HISTORY_KIND = { enum: [...STATUS.enum, 'followUp', 'followUpDismissed', 'reply'] };

const SUMMARY = obj({
  id: ID, vacancyId: ID, company: str(V.company), title: str(V.title), language: LANGUAGE, status: STATUS,
  createdAt: TIMESTAMP, updatedAt: TIMESTAMP, approvedAt: nullable(TIMESTAMP), writtenBy: PROVIDER,
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
    headline: str(L.headline), headlineEditedByHand: { type: 'boolean' },
    descriptions: { type: 'object', maxProperties: 100, additionalProperties: str(L.description) },
    skillGroups: { type: 'array', maxItems: 150, items: obj({ name: str(L.groupName), skillIds: { type: 'array', maxItems: 150, items: { type: 'string', maxLength: 64 } } }) },
    translations: { type: 'object', maxProperties: 200, additionalProperties: str(L.translation) },
  }),
  attachments: { type: 'array', maxItems: L.attachments, uniqueItems: true, items: { type: 'string', maxLength: 64 } },
  history: {
    type: 'array', maxItems: L.history,
    items: { type: 'object', additionalProperties: false, required: ['kind', 'at'], properties: { kind: HISTORY_KIND, at: TIMESTAMP, note: str(L.note), to: str(L.address), messageId: str(L.messageId), threadId: { type: 'string', pattern: '^[0-9a-f]{1,64}$' } } },
  },
  sentAt: nullable(TIMESTAMP),
  sentEmail: nullable(obj({ to: str(L.address), subject: str(L.emailSubject), body: str(L.emailBody), attachments: { type: 'array', maxItems: 30, items: str(L.fileName) } })),
  offerReply: nullable(obj({ offered: str(L.offerField), wanted: str(L.offerField), body: str(L.offerBody), createdAt: TIMESTAMP, updatedAt: TIMESTAMP })),
  writtenBy: PROVIDER,
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
