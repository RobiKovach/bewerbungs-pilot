import type { EmploymentType, Language, Profile, RemoteKind, Salutation, VacancyContact } from '@bp/shared';
import { fenceUntrusted } from '../../llm/fence.js';
import type { JsonSchema, LlmTask } from '../../llm/types.js';
import { EMPLOYMENT_TYPES } from '../../profile/schema.js';
import { scoringProfile } from '../profile-context.js';
import { VACANCY_LIMITS } from '../schema.js';
import { SCORE_FIELDS, SCORING_RULES } from './score.js';

export const MANUAL_TEXT_MIN = 200;
export const MANUAL_TEXT_MAX = 30_000;

export interface ManualOutput {
  isVacancy: boolean; title: string; company: string; city: string; remote: RemoteKind; employment: EmploymentType[];
  salaryText: string; contact: { email: string; salutation: Salutation; name: string };
  score: number; why: string[]; missing: string[];
}
export interface ManualFields {
  title: string; company: string; locations: string[]; remote: RemoteKind; employment: EmploymentType[]; salaryText: string;
  contact: VacancyContact | null;
}

const S = { type: 'string' };
const SCHEMA: JsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['isVacancy', 'title', 'company', 'city', 'remote', 'employment', 'salaryText', 'contact', 'score', 'why', 'missing'],
  properties: {
    isVacancy: { type: 'boolean' }, title: S, company: S, city: S,
    remote: { enum: ['yes', 'partial', 'no', 'unknown'] },
    employment: { type: 'array', items: { enum: [...EMPLOYMENT_TYPES] } },
    salaryText: S,
    contact: {
      type: 'object', additionalProperties: false, required: ['email', 'salutation', 'name'],
      properties: { email: S, salutation: { enum: ['', 'Frau', 'Herr'] }, name: S },
    },
    ...SCORE_FIELDS,
  },
};

const RULES = `A job seeker pasted the text of a job offer they found themselves. Do two things.

1. Read the offer's facts:
- isVacancy: false if the text is not a job offer (then leave everything else empty and score 0).
- title and company exactly as written in the text, without translating them.
- city: the main work place, "" if none. remote: yes (fully remote), partial (some home office), no, unknown.
- employment: fulltime, parttime, minijob, apprenticeship, internship — only what the text says.
- salaryText: the salary exactly as written, "" if none.
- contact: e-mail address and contact person ONLY if they literally appear in the text; salutation "Frau"/"Herr" only if
  the text makes it clear. Otherwise "". Never guess an address.

2. Compare the offer with the person's profile and give score, why and missing:
${SCORING_RULES}`;

export function extractManualTask(text: string, profile: Profile, language: Language): LlmTask {
  return {
    id: 'extract-manual',
    prompt: [
      RULES,
      `The person's profile:\n${fenceUntrusted('profile', JSON.stringify(scoringProfile(profile), null, 1))}`,
      `The pasted offer:\n${fenceUntrusted('pasted vacancy', text.slice(0, MANUAL_TEXT_MAX))}`,
    ].join('\n\n'),
    schema: SCHEMA,
    replyLanguage: language,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const contains = (text: string, part: string) => text.toLowerCase().includes(part.toLowerCase());

/** Contact data only when the pasted text literally contains it — checked here, not trusted from the prompt. */
function checkedContact(c: ManualOutput['contact'], text: string): VacancyContact | null {
  const email = c.email.trim();
  const name = c.name.trim();
  const keptEmail = email && EMAIL.test(email) && contains(text, email) ? email.slice(0, VACANCY_LIMITS.email) : '';
  const nameOk = name.length >= 3 && contains(text, name);
  const keptName = nameOk ? name.slice(0, VACANCY_LIMITS.name) : '';
  const salutation: Salutation = nameOk ? c.salutation : '';
  return keptEmail || keptName ? { email: keptEmail, salutation, name: keptName } : null;
}

export function toManualFields(out: ManualOutput, text: string): ManualFields {
  const city = out.city.trim().slice(0, VACANCY_LIMITS.location);
  return {
    title: out.title.trim().slice(0, VACANCY_LIMITS.title),
    company: out.company.trim().slice(0, VACANCY_LIMITS.company),
    locations: city ? [city] : [],
    remote: out.remote,
    employment: [...new Set(out.employment)],
    salaryText: out.salaryText.trim().slice(0, VACANCY_LIMITS.salary),
    contact: checkedContact(out.contact, text),
  };
}
