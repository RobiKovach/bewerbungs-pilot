import type { KnownFormId, NachweisSetup } from '@bp/shared';
import { AppError } from '../errors.js';
import { readDocx, writeDocx, type DocxParts } from './docx.js';
import { fillBbw, recognizeBbw } from './forms/bbw.js';
import { toHeader } from './forms/header.js';
import { fillStandard } from './forms/standard.js';
import type { NachweisRow } from './rows.js';

/** The own blank forms the app knows (spec 0.15.0, 8.2). */
const KNOWN: Record<KnownFormId, { recognize: (p: DocxParts) => boolean; fill: typeof fillBbw }> = {
  'bbw-qgz-pp018': { recognize: recognizeBbw, fill: fillBbw },
};

/** Which known own form this file is, or null (not a docx, or a form the app does not know). */
export async function recognizeForm(buf: Buffer): Promise<KnownFormId | null> {
  let parts: DocxParts;
  try {
    parts = await readDocx(buf);
  } catch {
    return null;
  }
  for (const [id, form] of Object.entries(KNOWN) as [KnownFormId, (typeof KNOWN)[KnownFormId]][]) {
    if (form.recognize(parts)) return id;
  }
  return null;
}

/** A filled Nachweis as .docx bytes. An own blank that no longer matches its form → NACHWEIS_FORM_CHANGED. */
export async function buildNachweis(blank: Buffer, form: 'standard' | KnownFormId, setup: NachweisSetup, rows: NachweisRow[]): Promise<Buffer> {
  const header = toHeader(setup, rows);
  if (form === 'standard') return writeDocx(fillStandard(await readDocx(blank), header, rows));
  let parts: DocxParts;
  try {
    parts = await readDocx(blank);
  } catch {
    throw new AppError('NACHWEIS_FORM_CHANGED', 'own blank is not readable');
  }
  const known = KNOWN[form];
  if (!known.recognize(parts)) throw new AppError('NACHWEIS_FORM_CHANGED', `own blank no longer matches ${form}`);
  return writeDocx(known.fill(parts, header, rows));
}
