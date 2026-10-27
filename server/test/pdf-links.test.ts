import { describe, it, expect } from 'vitest';
import { MAX_STORED_TEXT, noteUrls, readNotePdfs, withPdfBlocks } from '../src/vacancies/pdf-links.js';
import { MANUAL_TEXT_MAX } from '../src/vacancies/tasks/extract-manual.js';
import { FakePdfFetcher } from './helpers/vacancies.js';

describe('note PDF links (0.9.1)', () => {
  it('noteUrls trims trailing punctuation and skips duplicates and the link field', () => {
    expect(noteUrls('see https://a.example/x.pdf). and https://a.example/x.pdf, https://b.example/y', 'https://b.example/y')).toEqual(['https://a.example/x.pdf']);
  });

  it('a long page never pushes the PDF blocks out of what the AI reads or what is stored', () => {
    const page = 'p'.repeat(59_000);
    const { forAi, stored } = withPdfBlocks(page, ['PDF (a.example):\nInhalt']);
    expect(forAi.length).toBeLessThanOrEqual(MANUAL_TEXT_MAX);
    expect(forAi.endsWith('PDF (a.example):\nInhalt')).toBe(true);
    expect(stored.length).toBeLessThanOrEqual(MAX_STORED_TEXT);
    expect(stored.endsWith('PDF (a.example):\nInhalt')).toBe(true);
  });

  it('no budget left → a .pdf link gives notePdfUnreadable without a download', async () => {
    const fetcher = new FakePdfFetcher();
    const r = await readNotePdfs(fetcher, ['https://a.example/x.pdf', 'https://a.example/page'], new AbortController().signal, 500);
    expect(r).toEqual({ blocks: [], notices: ['notePdfUnreadable'] });
    expect(fetcher.calls).toEqual([]);
  });

  it('"Stop" while a PDF was being read wins over its result', async () => {
    const ctrl = new AbortController();
    const fetcher = new FakePdfFetcher(() => { ctrl.abort(); return { ok: true, host: 'a.example', text: 'Inhalt' }; });
    await expect(readNotePdfs(fetcher, ['https://a.example/x.pdf'], ctrl.signal, 25_000)).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
  });
});
