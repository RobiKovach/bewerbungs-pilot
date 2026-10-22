import fs from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';
import { AppError } from '../errors.js';

/** Below this many letters a PDF is treated as a scan or photo (spec §6). */
export const MIN_PDF_LETTERS = 200;

export const countLetters = (text: string): number => (text.match(/\p{L}/gu) ?? []).length;

/** Plain text of a PDF, for AI helpers that never get files (ChatGPT). Claude still reads the PDF itself. */
export async function pdfToText(file: string): Promise<string> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    // verbosity 0 = errors only: font warnings ("TT: undefined function") are noise for a text read.
    pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)), { verbosity: 0 });
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch (err) {
    throw new AppError('CV_UNREADABLE', `pdf: ${err instanceof Error ? err.message : String(err)}`, 'cvPdfBroken');
  } finally {
    await pdf?.loadingTask.destroy().catch(() => undefined);
  }
}
