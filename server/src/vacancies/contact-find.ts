import type { ContactProposal, Language, VacancyContact } from '@bp/shared';
import { AppError } from '../errors.js';
import type { LlmQueue } from '../llm/queue.js';
import type { Logger } from '../log.js';
import { isAaHost } from './aa-links.js';
import { emptyContact, nameWindow, needsName, parseContact } from './contact-parse.js';
import type { ContactFindResult } from './sources/aa-contact-window.js';
import type { PageReader } from './sources/page-reader.js';
import { checkPublicUrl } from './sources/safe-address.js';
import { contactNameTask, withContactName, type ContactNameOutput } from './tasks/contact-name.js';

/**
 * Turns page text into a contact proposal (0.9.1 B5): the deterministic parser first; the AI only for the name, only
 * when an e-mail or phone was found without one. Nothing here is saved — the person checks the fields and saves.
 */

const FIELDS: Array<keyof VacancyContact> = ['email', 'salutation', 'name', 'phone', 'street', 'postcode', 'city'];

export interface ContactFindDeps { queue: LlmQueue; pageReader: PageReader; logger: Logger; language: () => Language }

/** No lookup in the pre-check: a name always ends as 'dns' there, which the reader's own check then decides. */
const RESOLVED_BY_READER = async (): Promise<string[]> => { throw new Error('resolved by the page reader'); };

const proposalOf = (contact: VacancyContact): ContactProposal => ({ proposal: contact, found: FIELDS.filter((f) => contact[f] !== '') });
const hasReach = (c: VacancyContact) => c.email !== '' || c.phone !== '';

export function emptyProposal(): ContactProposal {
  return proposalOf(emptyContact());
}

/**
 * The proposal for `text`. The AI name step never fails the request: no AI helper chosen, a limit, a bad answer —
 * the proposal simply comes without a name (the person can type it). Only the person stopping it is passed on.
 */
export async function proposalFromText(text: string, d: ContactFindDeps, signal: AbortSignal): Promise<ContactProposal> {
  const parsed = parseContact(text);
  if (!needsName(parsed)) return proposalOf(parsed.contact);
  const window = nameWindow(text, parsed.contact);
  try {
    const { value } = await d.queue.runTagged<ContactNameOutput>(contactNameTask(window, d.language()), signal);
    return proposalOf(withContactName(parsed.contact, value, window));
  } catch (err) {
    if (signal.aborted) throw err;
    d.logger.warn('vacancy.contactName_failed', { code: err instanceof AppError ? err.code : 'UNKNOWN' });
    return proposalOf(parsed.contact);
  }
}

/** The log result for a finished proposal. */
export const resultOf = (p: ContactProposal): ContactFindResult => (hasReach(p.proposal) ? 'ok' : 'none');

/** The log result for an error of a page read (never the URL or text). */
export function errorResult(err: unknown, signal: AbortSignal): ContactFindResult {
  if (signal.aborted || (err instanceof AppError && (err.reason === 'cancelledByUser' || err.code === 'LLM_CANCELLED'))) return 'cancelled';
  if (err instanceof AppError && err.detailsForLog.includes('blocked')) return 'blocked';
  return 'failed';
}

/**
 * Reads a page that is not on the Arbeitsagentur site (the partner page, or the employer's site the AA block linked)
 * with the headless page reader (0.8.3 rules unchanged) and parses it. An AA host is refused, and so is any link the
 * public-address check refuses without a DNS lookup (scheme, port, credentials, localhost, an internal IP): the
 * name itself is resolved by the reader, whose filter checks the page and every request again (no second lookup here).
 */
export async function proposalFromPage(url: string, d: ContactFindDeps, signal: AbortSignal): Promise<ContactProposal> {
  if (!URL.canParse(url)) throw new AppError('BAD_REQUEST', 'not a link', 'pageUnreadable');
  if (isAaHost(url)) throw new AppError('BAD_REQUEST', 'partner page on the Arbeitsagentur site', 'pageUnreadable');
  const pre = await checkPublicUrl(url, RESOLVED_BY_READER);
  if (!pre.ok && pre.why !== 'dns') throw new AppError('BAD_REQUEST', `blocked: ${pre.why}`, 'pageUnreadable');
  const text = await d.pageReader.read(url, signal);
  return proposalFromText(text, d, signal);
}

/** Logs a find attempt: only where it looked and how it ended. */
export function logFind(logger: Logger, source: 'partner' | 'paste', result: ContactFindResult): void {
  logger.info('vacancy.contactFind', { source, result });
}

/** A saved contact: trimmed; all fields empty = no contact (null). */
export function normaliseContact(c: VacancyContact | null): VacancyContact | null {
  if (!c) return null;
  const t: VacancyContact = {
    email: c.email.trim(), salutation: c.salutation, name: c.name.replace(/\s+/g, ' ').trim(), phone: c.phone.trim(),
    street: c.street.trim(), postcode: c.postcode.trim(), city: c.city.trim(),
  };
  return FIELDS.some((f) => f !== 'salutation' && t[f] !== '') ? t : null;
}
