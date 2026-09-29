import { describe, it, expect } from 'vitest';
import type { Vacancy } from '@bp/shared';
import { H, makeApp } from './helpers/app.js';
import { details, fakeSource, hit, scoringClaude, vacancy } from './helpers/vacancies.js';

const TEXT = 'Frontend Developer (m/w/d) bei der Muster GmbH in Dresden. Wir bieten Homeoffice. Ansprechpartnerin: Frau Erika Beispiel, bewerbung@muster.example. ' + 'Aufgaben und Profil. '.repeat(12);
const MANUAL = {
  isVacancy: true, title: 'Frontend Developer (m/w/d)', company: 'Muster GmbH', city: 'Dresden', remote: 'partial', employment: ['fulltime'],
  salaryText: '', contact: { email: 'bewerbung@muster.example', salutation: 'Frau', name: 'Erika Beispiel' }, score: 82, why: ['React'], missing: ['Deutsch C1'],
};
type Ctx = Awaited<ReturnType<typeof makeApp>>;
const paste = (ctx: Ctx, body: unknown) => ctx.app.inject({ method: 'POST', url: '/api/vacancies/manual', headers: H, payload: body as Record<string, unknown> });

describe('POST /api/vacancies/manual — pasted text', () => {
  it('one Claude run: fields, checked contact, score, text; marked as added by hand', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }) });
    const res = await paste(ctx, { text: TEXT, url: 'https://karriere.muster.example/job/7' });
    expect(res.statusCode).toBe(200);
    const v = res.json().vacancy as Vacancy;
    expect(v).toMatchObject({
      source: 'manual', sourceId: null, addedManually: true, title: 'Frontend Developer (m/w/d)', company: 'Muster GmbH',
      locations: ['Dresden'], remote: 'partial', url: 'https://karriere.muster.example/job/7', status: 'new', scoreState: 'scored',
      score: { value: 82, why: ['React'], missing: ['Deutsch C1'] },
      contact: { email: 'bewerbung@muster.example', salutation: 'Frau', name: 'Erika Beispiel' },
    });
    expect(ctx.vacancyStore.readText(v.id)).toBe(TEXT);
    expect(ctx.provider.calls).toHaveLength(1);
    expect(ctx.provider.calls[0].prompt).toMatch(/<<<UNTRUSTED_PASTED_VACANCY_[0-9a-f]{16}>>>/);
    expect(ctx.source.detailCalls).toEqual([]);
  });

  it('drops a contact Claude made up', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: { ...MANUAL, contact: { email: 'chef@muster.example', salutation: 'Herr', name: 'Hans Erfunden' } } }) });
    expect((await paste(ctx, { text: TEXT })).json().vacancy.contact).toBeNull();
  });

  it('too short → 400 pastedTooShort without asking Claude', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }) });
    const res = await paste(ctx, { text: 'Frontend Developer bei Muster' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'BAD_REQUEST', reason: 'pastedTooShort', params: { min: 200 } });
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it('not an offer → 422, nothing saved', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: { ...MANUAL, isVacancy: false, title: '' } }) });
    const res = await paste(ctx, { text: TEXT });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('NOT_A_VACANCY');
    expect(ctx.vacancyStore.list()).toEqual([]);
  });

  it('already in the list (even hidden) → 409 with the id of the existing card', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }) });
    ctx.vacancyStore.add(vacancy({ id: 'old', company: 'Muster GmbH & Co. KG', title: 'Frontend-Developer (w/m/d)', status: 'hidden', hiddenAt: '2026-09-28T10:00:00.000Z' }), null);
    const res = await paste(ctx, { text: TEXT });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'VACANCY_DUPLICATE', params: { id: 'old' } });
    expect(ctx.vacancyStore.list()).toHaveLength(1);
  });

  it('a link that is not http(s) → 400', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }) });
    expect((await paste(ctx, { text: TEXT, url: 'javascript:alert(1)' })).statusCode).toBe(400);
  });

  it('a Claude error saves nothing', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL, before: () => { throw new Error('boom'); } }) });
    expect((await paste(ctx, { text: TEXT })).statusCode).toBe(500);
    expect(ctx.vacancyStore.list()).toEqual([]);
  });

  it('an upper-case scheme or a link with an embedded newline is refused by validation, before Claude runs', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }) });
    for (const url of ['HTTPS://karriere.muster.example/job/7', 'https://karriere.muster.example/job\nX-Injected: 1']) {
      const res = await paste(ctx, { text: TEXT, url });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    }
    expect(ctx.provider.calls).toHaveLength(0);
  });
});

describe('POST /api/vacancies/manual — Arbeitsagentur link', () => {
  const LINK = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1111111111-S';
  const h = hit({ sourceId: '10000-1111111111-S', title: 'Webentwickler (m/w/d)', company: 'Beispiel AG' });

  it('asks the API by number (never opens the link) and scores the offer', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ score: () => 64 }), source: fakeSource({ details: () => details(h, 'API-Text') }) });
    const v = (await paste(ctx, { url: LINK })).json().vacancy as Vacancy;
    expect(ctx.source.detailCalls).toEqual(['10000-1111111111-S']);
    expect(v).toMatchObject({ source: 'arbeitsagentur', sourceId: '10000-1111111111-S', addedManually: true, title: 'Webentwickler (m/w/d)', scoreState: 'scored', score: { value: 64 } });
    expect(ctx.vacancyStore.readText(v.id)).toBe('API-Text');
  });

  it('known number → 409 before any request; gone → 404 offerGone', async () => {
    const known = await makeApp({ source: fakeSource({ details: () => details(h) }) });
    known.vacancyStore.add(vacancy({ id: 'k', sourceId: '10000-1111111111-S' }), null);
    const dup = await paste(known, { url: LINK });
    expect(dup.json().error).toMatchObject({ code: 'VACANCY_DUPLICATE', params: { id: 'k' } });
    expect(known.source.detailCalls).toEqual([]);
    const gone = await makeApp({ source: fakeSource({ details: () => null }) });
    const res = await paste(gone, { url: LINK });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: 'VACANCY_NOT_FOUND', reason: 'offerGone' });
  });

  it('a look-alike link is treated as a plain link: it needs text and is never requested', async () => {
    const ctx = await makeApp({ source: fakeSource({ details: () => details(h) }) });
    const res = await paste(ctx, { url: 'https://www.arbeitsagentur.de.evil.example/jobsuche/jobdetail/10000-1111111111-S' });
    expect(res.json().error.reason).toBe('pastedTooShort');
    expect(ctx.source.detailCalls).toEqual([]);
  });

  it('a concurrent search adding the same offer while Claude scores the paste does not create a second card', async () => {
    const box: { ctx?: Ctx } = {};
    const ctx = await makeApp({
      provider: scoringClaude({
        score: () => 64,
        // Simulate the running search committing the very same offer while this paste is still waiting
        // in the shared Claude queue — the realistic trigger for the race (T9 / Important 2).
        before: async () => {
          box.ctx!.vacancyStore.add(vacancy({ id: 'race', sourceId: '10000-1111111111-S', title: 'Webentwickler (m/w/d)', company: 'Beispiel AG' }), 'API-Text');
        },
      }),
      source: fakeSource({ details: () => details(h, 'API-Text') }),
    });
    box.ctx = ctx;
    const res = await paste(ctx, { url: LINK });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'VACANCY_DUPLICATE', params: { id: 'race' } });
    expect(ctx.vacancyStore.list()).toHaveLength(1);
  });
});
