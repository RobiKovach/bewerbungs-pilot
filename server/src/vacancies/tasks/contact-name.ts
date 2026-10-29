import type { Language, Salutation, VacancyContact } from '@bp/shared';
import { fenceUntrusted } from '../../llm/fence.js';
import type { JsonSchema, LlmTask } from '../../llm/types.js';
import { NAME_WINDOW_CHARS } from '../contact-parse.js';
import { VACANCY_LIMITS } from '../schema.js';

/**
 * Asked only when the deterministic parser found an e-mail or phone but no person (contact-parse.ts needsName):
 * who is the contact person in this short part of the page? The answer is checked here, never trusted.
 */

export interface ContactNameOutput { salutation: Salutation; name: string }

const SCHEMA: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['salutation', 'name'],
  properties: { salutation: { enum: ['', 'Frau', 'Herr'] }, name: { type: 'string' } },
};

const RULES = `Below is a short part of a job offer page around the employer's contact details. Name the contact person.

- name: the contact person's first and last name (with "Dr." or "Prof." if written), exactly as written in the text.
  Only a real person — never a company, a department ("Personalabteilung", "Recruiting-Team") or a job title.
  "" if the text names no person.
- salutation: "Frau" or "Herr" only if the text makes it clear (for example "Frau Erika Musterfrau",
  "Ansprechpartnerin"); otherwise "". Never guess it from the first name.`;

/** `window`: the part of the page around the contact (contact-parse.ts nameWindow), cut to NAME_WINDOW_CHARS. */
export function contactNameTask(window: string, language: Language): LlmTask {
  return {
    id: 'contact-name',
    prompt: [RULES, `The page part:\n${fenceUntrusted('contact block', window.slice(0, NAME_WINDOW_CHARS))}`].join('\n\n'),
    schema: SCHEMA,
    replyLanguage: language,
  };
}

/** The contact with the AI's name added — only when that name literally stands in the window; else unchanged. */
export function withContactName(contact: VacancyContact, out: ContactNameOutput, window: string): VacancyContact {
  const name = out.name.replace(/\s+/g, ' ').trim();
  const literal = window.replace(/\s+/g, ' ').toLowerCase().includes(name.toLowerCase());
  if (name.length < 3 || !/\p{L}{2,}/u.test(name) || !literal) return contact;
  return { ...contact, name: name.slice(0, VACANCY_LIMITS.name), salutation: out.salutation };
}
