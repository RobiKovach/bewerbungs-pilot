import { describe, expect, it } from 'vitest';
import type { ResearchNews } from '@bp/shared';
import type { Collected } from '../src/research/collect.js';
import type { FoundPage } from '../src/research/contact-merge.js';
import { RESEARCH_TEXT_CHARS, companyResearchTask, toResearch, type ResearchOutput } from '../src/research/task.js';
import { scriptedResponse } from '../src/llm/fake-scripted.js';
import { strictProblems } from '../src/llm/codex-cli.js';
import { validateOutput } from '../src/llm/validate.js';
import { emptyContact } from '../src/vacancies/contact-parse.js';

const page = (kind: FoundPage['kind'], url: string, text: string): FoundPage => ({ url, kind, text, links: [] });
const news = (n: number): ResearchNews => ({ title: `Muster GmbH Nachricht ${n}`, date: '2026-10-01', source: 'Zeitung', url: `https://news.google.com/articles/${n}` });

function collected(pages: FoundPage[], items: ResearchNews[] | null = []): Collected {
  return {
    website: 'https://muster.example',
    pages,
    contact: emptyContact(),
    news: items,
    sources: [...pages.map((p) => ({ url: p.url, kind: p.kind })), ...(items ?? []).map((n) => ({ url: n.url, kind: 'news' as const }))],
  };
}

const C = collected([
  page('vacancy', 'https://muster.example/jobs/1', 'Wir suchen einen Webentwickler.'),
  page('impressum', 'https://muster.example/impressum', 'Muster GmbH, Musterstraße 1, 01067 Dresden.'),
], [news(1), news(2)]);
const META = { provider: 'chatgpt' as const, language: 'de' as const, startedAt: '2026-11-11T10:00:00.000Z', now: '2026-11-11T10:01:00.000Z', websiteByPerson: false };
const out = (o: Partial<ResearchOutput>): ResearchOutput => ({ about: 'Muster GmbH baut Software.', news: [], redFlags: [], facts: [], ...o });

describe('companyResearchTask / toResearch (company research, 0.13.0)', () => {
  it('a fact with a source index not given is dropped', () => {
    const r = toResearch(out({ facts: [{ text: 'Gibt es seit 1990.', source: 1 }, { text: 'Erfunden.', source: 9 }, { text: 'Negativ.', source: -1 }] }), C, META);
    expect(r.facts.map((f) => f.text)).toEqual(['Gibt es seit 1990.']);
    expect(r.facts[0].sourceUrl).toBe('https://muster.example/impressum');
    expect(r.facts[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('all points dropped → empty arrays, about kept', () => {
    const r = toResearch(out({ facts: [{ text: 'x', source: 7 }], redFlags: [{ text: 'y', source: 8 }], news: [42] }), C, META);
    expect(r).toMatchObject({ facts: [], redFlags: [], news: [], about: 'Muster GmbH baut Software.', state: 'done', error: null });
    expect(r).toMatchObject({ provider: 'chatgpt', language: 'de', startedAt: META.startedAt, finishedAt: META.now, website: 'https://muster.example', websiteByPerson: false, newsFailed: false });
    expect(r.sources).toEqual(C.sources);
  });

  it('news are taken only from the collected list by index', () => {
    // Sources: 0 vacancy, 1 impressum, 2 news(1), 3 news(2). A page number or an unknown number is no news.
    const r = toResearch(out({ news: [3, 0, 2, 3, 99] }), C, META);
    expect(r.news).toEqual([news(2), news(1)]);
    expect(toResearch(out({}), collected([], null), META).newsFailed).toBe(true);
  });

  it('a red flag needs a source too; at most 3 points, texts cut to the limit', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ text: `Fakt ${i} ${'a'.repeat(400)}`, source: 0 }));
    const r = toResearch(out({ facts: many, redFlags: [{ text: 'Insolvenz angemeldet.', source: 2 }, { text: 'Gerücht', source: 5 }] }), C, META);
    expect(r.facts).toHaveLength(3);
    expect(r.facts[0].text.length).toBeLessThanOrEqual(300);
    expect(r.redFlags.map((f) => f.sourceUrl)).toEqual(['https://news.google.com/articles/1']);
  });

  it('prompt contains no person data and fences page text', () => {
    const task = companyResearchTask('Muster GmbH', C, 'de');
    expect(task.id).toBe('company-research');
    expect(task.replyLanguage).toBe('de');
    expect(task.prompt).toContain('Muster GmbH');
    expect(task.prompt).toMatch(/\[1\] impressum https:\/\/muster\.example\/impressum\n[^\n]*\n<<<UNTRUSTED_PAGE_[0-9a-f]{16}>>>\nMuster GmbH, Musterstraße 1/);
    expect(task.prompt).toMatch(/<<<UNTRUSTED_NEWS_[0-9a-f]{16}>>>/);
    expect(task.prompt).toContain('Muster GmbH Nachricht 2');
    // The task takes no person data at all; nothing from a profile can be in it.
    for (const word of ['profile', 'Profil', 'Lebenslauf']) expect(task.prompt).not.toContain(word);
    expect(strictProblems(task.schema)).toEqual([]);
  });

  it('texts over 30 000 characters are cut, Impressum kept', () => {
    const big = collected([
      page('vacancy', 'https://muster.example/jobs/1', `VACANCY-START ${'v'.repeat(40_000)}`),
      page('impressum', 'https://muster.example/impressum', `IMPRESSUM-START ${'i'.repeat(5_000)} IMPRESSUM-END`),
      page('home', 'https://muster.example', `HOME-START ${'h'.repeat(20_000)}`),
    ]);
    const task = companyResearchTask('Muster GmbH', big, 'de');
    expect(task.prompt).toContain('IMPRESSUM-END');
    expect(task.prompt).toContain('HOME-START');
    expect(task.prompt.indexOf('IMPRESSUM-START')).toBeLessThan(task.prompt.indexOf('HOME-START'));
    const pageChars = (task.prompt.match(/[vih]{1000,}/g) ?? []).join('').length;
    expect(pageChars).toBeLessThanOrEqual(RESEARCH_TEXT_CHARS);
    // The vacancy page comes last and gets only what is left; a point on it is still accepted.
    expect(toResearch(out({ facts: [{ text: 'Sucht Entwickler.', source: 0 }] }), big, META).facts).toHaveLength(1);
  });

  it('a page cut away completely is no source', () => {
    const full = collected([
      page('vacancy', 'https://muster.example/jobs/1', 'Vakanz'),
      page('impressum', 'https://muster.example/impressum', 'i'.repeat(RESEARCH_TEXT_CHARS + 10)),
    ]);
    expect(companyResearchTask('Muster GmbH', full, 'de').prompt).not.toContain('Vakanz');
    expect(toResearch(out({ facts: [{ text: 'f', source: 0 }] }), full, META).facts).toEqual([]);
  });

  it('only the first 10 news go to the AI', () => {
    const lots = collected([], Array.from({ length: 12 }, (_, i) => news(i)));
    const task = companyResearchTask('Muster GmbH', lots, 'de');
    expect(task.prompt).toContain('Nachricht 9');
    expect(task.prompt).not.toContain('Nachricht 10');
    expect(toResearch(out({ news: [10, 11] }), lots, META).news).toEqual([]);
  });

  it('the fake answer passes the schema and keeps 1 fact and 1 red flag (Ruling R4)', () => {
    const task = companyResearchTask('Muster GmbH', C, 'de');
    const answer = scriptedResponse(task) as ResearchOutput;
    expect(validateOutput(task.schema, answer)).toEqual({ ok: true });
    const r = toResearch(answer, C, META);
    expect(r.facts).toHaveLength(1);
    expect(r.redFlags).toHaveLength(1);
    expect(r.about).not.toBe('');
  });
});
