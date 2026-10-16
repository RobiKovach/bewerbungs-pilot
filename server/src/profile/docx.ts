import mammoth from 'mammoth';
import { AppError } from '../errors.js';

/** Plain text of a Word file. Claude reads PDFs itself; DOCX (and, for ChatGPT, PDF) arrive as text. */
export async function docxToText(file: string): Promise<string> {
  try {
    return (await mammoth.extractRawText({ path: file })).value;
  } catch (err) {
    throw new AppError('CV_UNREADABLE', `docx: ${err instanceof Error ? err.message : String(err)}`, 'cvDocxBroken');
  }
}
