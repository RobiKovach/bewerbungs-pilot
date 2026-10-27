import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countLetters, MIN_PDF_LETTERS, pdfBufferToText, pdfToText } from '../src/profile/pdf-text.js';
const fx = (n: string) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));

describe('pdfToText', () => {
  it('extracts the text of a text PDF', async () => {
    const t = await pdfToText(fx('cv-text.pdf'));
    expect(t).toContain('Max Mustermann');
    expect(t).toContain('Frontend-Entwickler');
    expect(countLetters(t)).toBeGreaterThanOrEqual(MIN_PDF_LETTERS);
  });
  it('a scan has (almost) no letters', async () => {
    expect(countLetters(await pdfToText(fx('cv-scan.pdf')))).toBeLessThan(MIN_PDF_LETTERS);
    expect(countLetters(await pdfToText(fx('cv-footer-only.pdf')))).toBeLessThan(MIN_PDF_LETTERS);
  });
  it('a broken PDF is CV_UNREADABLE', async () => {
    await expect(pdfToText(fx('broken.pdf'))).rejects.toMatchObject({ code: 'CV_UNREADABLE', reason: 'cvPdfBroken' });
  });
  it('a missing file is CV_UNREADABLE too', async () => {
    await expect(pdfToText(fx('no-such-file.pdf'))).rejects.toMatchObject({ code: 'CV_UNREADABLE', reason: 'cvPdfBroken' });
  });
  it('countLetters counts letters of any script, not digits or spaces', () => {
    expect(countLetters('Ольга 123 Kovač!')).toBe(10);
  });
});

describe('pdfBufferToText', () => {
  it('extracts the text of PDF bytes', async () => {
    const t = await pdfBufferToText(new Uint8Array(fs.readFileSync(fx('cv-text.pdf'))));
    expect(t).toContain('Max Mustermann');
  });
  it('garbage bytes throw a plain error (not an AppError)', async () => {
    const err = await pdfBufferToText(new TextEncoder().encode('<html>not a pdf</html>')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toHaveProperty('code', 'CV_UNREADABLE');
  });
});
