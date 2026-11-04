import { APPLICATION_ID } from '../applications/schema.js';
import type { JsonSchema } from '../llm/types.js';
import { validateOutput } from '../llm/validate.js';

export const PREP_SCHEMA_VERSION = 1;

export const PREP_LIMITS = {
  answer: 5000, question: 1000, code: 4000, questions: 20, employerQuestions: 10,
  feedback: 5000, fixes: 50, fix: 1000, area: 1000,
} as const;

const L = PREP_LIMITS;
const str = (maxLength: number): JsonSchema => ({ type: 'string', maxLength });
const nullable = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: 'null' }] });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const list = (items: JsonSchema, maxItems: number): JsonSchema => ({ type: 'array', maxItems, items });
const ID = { type: 'string', pattern: APPLICATION_ID.source };
const TIMESTAMP = str(40);
const PERCENT = { type: 'integer', minimum: 5, maximum: 95, multipleOf: 5 };

const FEEDBACK = obj({
  weak: { type: 'boolean' },
  content: str(L.feedback),
  languageFixes: list(obj({ said: str(L.fix), correct: str(L.fix), why: str(L.fix) }), L.fixes),
  better: str(L.feedback),
});
const ANSWER = obj({ text: str(L.answer), dontKnow: { type: 'boolean' }, updatedAt: TIMESTAMP, feedback: nullable(FEEDBACK) });
const QUESTION = obj({
  id: ID, kind: { enum: ['experience', 'theory', 'practice'] }, text: str(L.question), code: nullable(str(L.code)), answer: nullable(ANSWER),
});
const SUMMARY = obj({
  percent: PERCENT, previousPercent: nullable(PERCENT),
  areas: obj({ experience: str(L.area), theory: str(L.area), practice: str(L.area), language: str(L.area) }),
  biggestRisk: obj({ questionId: ID, why: str(L.area) }),
  fingerprint: { type: 'string', pattern: '^[0-9a-f]{64}$' }, createdAt: TIMESTAMP,
});
const PREP = obj({
  schemaVersion: { const: PREP_SCHEMA_VERSION }, applicationId: ID, language: { enum: ['de', 'en'] }, createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
  questions: list(QUESTION, L.questions), employerQuestions: list(str(L.question), L.employerQuestions), summary: nullable(SUMMARY),
});

export function validatePrep(doc: unknown): string | null {
  const r = validateOutput(PREP, doc);
  return r.ok ? null : r.errors;
}
