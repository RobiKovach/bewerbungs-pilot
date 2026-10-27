import type { ManualNotice } from '@bp/shared';
import { AppError } from '../errors.js';
import type { PdfFetcher } from './sources/pdf-fetch.js';
import { MANUAL_TEXT_MAX } from './tasks/extract-manual.js';

/** At most this many links of the person's note are tried as PDFs (spec 0.9.1, A2). */
export const MAX_NOTE_LINKS = 2;
/** Stored offer text (page + PDF blocks), the same limit as the page reader's text. */
export const MAX_STORED_TEXT = 60_000;
/** PDF blocks never take more than half of what the AI sees, so the page stays readable too. */
const MAX_BLOCKS_FOR_AI = Math.floor(MANUAL_TEXT_MAX / 2);

const URL_RE = /https?:\/\/[^\s<>"]+/g;
const isPdfPath = (url: string) => { try { return /\.pdf$/i.test(new URL(url).pathname); } catch { return false; } };

/** Up to two distinct http(s) links of the note (trailing `.,;)` trimmed), without the link field's own address. */
export function noteUrls(note: string, linkField: string): string[] {
  const out: string[] = [];
  for (const m of note.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;)]+$/, '');
    if (url === linkField || out.includes(url)) continue;
    out.push(url);
    if (out.length === MAX_NOTE_LINKS) break;
  }
  return out;
}

export const pdfBlock = (host: string, text: string) => `PDF (${host}):\n${text.trim()}`;

/**
 * The page (or link-field PDF) text with the note's PDF blocks after it: `forAi` keeps the blocks inside what the AI
 * reads (it sees the first MANUAL_TEXT_MAX characters), `stored` keeps them inside MAX_STORED_TEXT.
 */
export function withPdfBlocks(offer: string, blocks: string[]): { forAi: string; stored: string } {
  if (blocks.length === 0) return { forAi: offer, stored: offer };
  const tail = `\n\n${blocks.join('\n\n')}`.slice(0, MAX_BLOCKS_FOR_AI);
  return {
    forAi: offer.slice(0, MANUAL_TEXT_MAX - tail.length) + tail,
    stored: offer.slice(0, MAX_STORED_TEXT - tail.length) + tail,
  };
}

/**
 * Reads the note's links one after another within one shared time budget. Only real PDFs become blocks; a link that
 * is no PDF stays a plain link in the note. A link that looks like a PDF (path ends in .pdf) but cannot be read, or a
 * PDF without text, gives a notice — the vacancy is added anyway.
 */
export async function readNotePdfs(fetcher: PdfFetcher, urls: string[], signal: AbortSignal, budgetMs: number): Promise<{ blocks: string[]; notices: ManualNotice[] }> {
  const blocks: string[] = [];
  const notices = new Set<ManualNotice>();
  const deadline = Date.now() + budgetMs;
  for (const url of urls) {
    const left = deadline - Date.now();
    if (left < 1000) {
      if (isPdfPath(url)) notices.add('notePdfUnreadable');
      continue;
    }
    const r = await fetcher.fetch(url, signal, left);
    // The fetch stops its download on abort, but not a PDF that is being parsed: the person's "Stop" still wins.
    if (signal.aborted) throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
    if (r.ok) blocks.push(pdfBlock(r.host, r.text));
    else if (r.why === 'no-text') notices.add('notePdfNoText');
    else if (r.why !== 'not-pdf' && isPdfPath(url)) notices.add('notePdfUnreadable');
  }
  return { blocks, notices: [...notices] };
}

/**
 * The link field's own PDF: tried first when the address ends in .pdf, otherwise only after the page reader gave up.
 * Throws `pdfNoText` for a scan; any other failure is the caller's `pageUnreadable`.
 */
export async function readLinkPdf(fetcher: PdfFetcher, url: string, signal: AbortSignal, budgetMs?: number): Promise<string | null> {
  const r = await fetcher.fetch(url, signal, budgetMs);
  if (signal.aborted) throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
  if (r.ok) return r.text;
  if (r.why === 'no-text') throw new AppError('BAD_REQUEST', 'pdf has no text (scan)', 'pdfNoText');
  return null;
}

export { isPdfPath };
