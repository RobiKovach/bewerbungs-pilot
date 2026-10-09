import type { ApplicationPackage } from '@bp/shared';
import { fenceUntrusted } from '../../llm/fence.js';
import type { LlmTask } from '../../llm/types.js';
import type { PackageContext } from './context.js';

export const OFFER_REPLY_MAX_WORDS = 200;
const LANGUAGE_NAME = { de: 'German', en: 'English' } as const;

// "55.000", "55 000", "55,000" → "55000"; ranges keep both numbers.
const numbersIn = (s: string) => (s.replace(/(?<=\d)[.,'’\s\u00a0](?=\d{3}\b)/g, '').match(/\d+/g) ?? []);

/** Every number the person wrote in "how much I want" appears in the letter as a whole number. */
export function amountPresent(body: string, wanted: string): boolean {
  const inBody = new Set(numbersIn(body));
  const want = numbersIn(wanted);
  return want.length > 0 && want.every((n) => inBody.has(n));
}

export function offerReplyViolations(body: string, wanted: string, ctx: PackageContext): string[] {
  const out: string[] = [];
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words > OFFER_REPLY_MAX_WORDS) out.push(`The letter has ${words} words; at most ${OFFER_REPLY_MAX_WORDS}.`);
  if (!amountPresent(body, wanted)) out.push(`Name exactly the amount ${numbersIn(wanted).join(' / ')} from "how much I want" — no other amount.`);
  const lower = body.toLowerCase();
  for (const m of ctx.neverMention) if (lower.includes(m.toLowerCase())) out.push(`Do not mention "${m}" anywhere.`);
  return out;
}

/** Which kinds of checks failed, for the log and the error: never the words or amounts themselves. */
export function offerReplyViolationKinds(violations: string[]): string {
  const kinds = [
    ['length', /^The letter has /], ['amount', /^Name exactly the amount /], ['neverMention', /^Do not mention /],
  ] as const;
  return kinds.map(([k, re]) => { const n = violations.filter((v) => re.test(v)).length; return n > 0 ? `${k} x${n}` : ''; }).filter(Boolean).join(' | ');
}

export function offerReplyTask(ctx: PackageContext, p: ApplicationPackage, offered: string, wanted: string): LlmTask {
  const facts = { position: p.vacancy.title, company: p.vacancy.company, experience: ctx.experience, education: ctx.education, skills: ctx.skills.map((s) => s.name), languages: ctx.languages, stories: ctx.stories };
  return {
    prompt: [
      `You write a short email reply to a job offer, in ${LANGUAGE_NAME[p.language]}. Return { "body": "<the whole email text>" }.`,
      `Rules: at most ${OFFER_REPLY_MAX_WORDS} words; start with the salutation "${p.letter.salutation}"; say the person is glad about the offer and interested in the position; name exactly ONE amount — the one from "how much I want", never another number for the salary; justify it in one or two sentences using ONLY the facts below (never invent experience); warm, confident tone, no apologies, no pressure; end with "${p.language === 'de' ? 'Mit freundlichen Grüßen' : 'Kind regards'}" and the name "${p.snapshot.personal.fullName}".`,
      ctx.neverMention.length ? `Never mention: ${ctx.neverMention.join('; ')}.` : '',
      `Facts about the person and the position:\n${JSON.stringify(facts, null, 1)}`,
      `The amounts as the person typed them:\n${fenceUntrusted('amounts', JSON.stringify({ offered, wanted }))}`,
    ].filter(Boolean).join('\n\n'),
    schema: { type: 'object', additionalProperties: false, required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 3000 } } },
    replyLanguage: p.language,
  };
}
