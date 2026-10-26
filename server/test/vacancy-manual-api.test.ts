import { describe, it, expect } from 'vitest';
import type { Vacancy } from '@bp/shared';
import { AppError } from '../src/errors.js';
import { H, makeApp } from './helpers/app.js';
import { details, fakeSource, FakePageReader, hit, scoringClaude, vacancy } from './helpers/vacancies.js';

const TEXT = 'Frontend Developer (m/w/d) bei der Muster GmbH in Dresden. Wir bieten Homeoffice. Ansprechpartnerin: Frau Erika Beispiel, bewerbung@muster.example. ' + 'Aufgaben und Profil. '.repeat(12);
const MANUAL = {
  isVacancy: true, initiative: false, title: 'Frontend Developer (m/w/d)', company: 'Muster GmbH', city: 'Dresden', remote: 'partial', employment: ['fulltime'],
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

  it('a look-alike link is treated as a plain link: the Arbeitsagentur API is never asked', async () => {
    const ctx = await makeApp({ source: fakeSource({ details: () => details(h) }) });
    const res = await paste(ctx, { url: 'https://www.arbeitsagentur.de.evil.example/jobsuche/jobdetail/10000-1111111111-S' });
    expect(res.json().error.reason).toBe('pageUnreadable');
    expect(ctx.pageReader.calls).toEqual(['https://www.arbeitsagentur.de.evil.example/jobsuche/jobdetail/10000-1111111111-S']);
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

describe('0.8.0: a pasted offer remembers which AI scored it', () => {
  it('pasted text and an Arbeitsagentur link, scored by ChatGPT → score.provider chatgpt', async () => {
    const h = hit({ sourceId: '10000-2222222222-S' });
    const ctx = await makeApp({
      chosen: 'chatgpt', chatgpt: scoringClaude({ id: 'chatgpt', manual: MANUAL, score: () => 60 }),
      source: fakeSource({ details: () => details(h, 'API-Text') }),
    });
    const pasted = (await paste(ctx, { text: TEXT })).json().vacancy as Vacancy;
    expect(pasted.score).toMatchObject({ value: 82, provider: 'chatgpt' });
    const linked = (await paste(ctx, { url: 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-2222222222-S' })).json().vacancy as Vacancy;
    expect(linked.score).toMatchObject({ value: 60, provider: 'chatgpt' });
    expect(ctx.provider.calls).toHaveLength(0);
  });
});

describe('0.8.3: a pasted link that is not Arbeitsagentur is read by the app itself', () => {
  const LINK = 'https://jobs.example.de/123';

  it('link and no text → the page is read once; its text is scored and stored, the link kept', async () => {
    const reader = new FakePageReader(() => TEXT);
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }), pageReader: reader });
    const res = await paste(ctx, { url: LINK });
    expect(res.statusCode).toBe(200);
    const v = res.json().vacancy as Vacancy;
    expect(v).toMatchObject({ source: 'manual', url: LINK, title: 'Frontend Developer (m/w/d)' });
    expect(reader.calls).toEqual([LINK]);
    expect(ctx.vacancyStore.readText(v.id)).toBe(TEXT);
    expect(ctx.provider.calls).toHaveLength(1);
  });

  it('text that is too short is the person\'s note: the page is read, the AI gets both, the card keeps both', async () => {
    const reader = new FakePageReader(() => TEXT);
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }), pageReader: reader });
    const res = await paste(ctx, { url: LINK, text: '  Frontend, bitte die Stelle in Dresden  ' });
    expect(res.statusCode).toBe(200);
    expect(reader.calls).toEqual([LINK]);
    const prompt = ctx.provider.calls[0].prompt;
    expect(prompt).toMatch(/<<<UNTRUSTED_PERSON_NOTE_[0-9a-f]{16}>>>\nFrontend, bitte die Stelle in Dresden\n/);
    expect(prompt).toMatch(/<<<UNTRUSTED_PASTED_VACANCY_[0-9a-f]{16}>>>\nFrontend Developer \(m\/w\/d\) bei der Muster GmbH/);
    expect(prompt).toContain('never pick another');
    const v = res.json().vacancy as Vacancy;
    expect(ctx.vacancyStore.readText(v.id)).toBe(`Notiz: Frontend, bitte die Stelle in Dresden\n\n${TEXT}`);
    expect(v.initiative).toBeUndefined();
  });

  it('no note → no note block and no note rules; the stored text is the page alone', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }), pageReader: new FakePageReader(() => TEXT) });
    const v = (await paste(ctx, { url: LINK, text: '   ' })).json().vacancy as Vacancy;
    expect(ctx.provider.calls[0].prompt).not.toContain('UNTRUSTED_PERSON_NOTE');
    expect(ctx.provider.calls[0].prompt).not.toContain('never pick another');
    expect(ctx.vacancyStore.readText(v.id)).toBe(TEXT);
  });

  it('0.9.0: an initiative application is a card (not NOT_A_VACANCY), marked initiative', async () => {
    const OVERVIEW = 'Jobs und Karriere bei der Muster GmbH. Werkstudent*in Softwareentwicklung. Initiativbewerbung. ' + 'Wir freuen uns auf dich. '.repeat(10);
    const answer = { ...MANUAL, isVacancy: false, initiative: true, title: 'Initiativbewerbung – Softwareentwickler', contact: { email: '', salutation: '', name: '' } };
    const ctx = await makeApp({ provider: scoringClaude({ manual: answer }), pageReader: new FakePageReader(() => OVERVIEW) });
    const res = await paste(ctx, { url: LINK, text: 'Initiativbewerbung als Softwareentwickler' });
    expect(res.statusCode).toBe(200);
    const v = res.json().vacancy as Vacancy;
    expect(v).toMatchObject({ title: 'Initiativbewerbung – Softwareentwickler', initiative: true, addedManually: true });
    expect(ctx.vacancyStore.get(v.id)?.initiative).toBe(true);
  });

  it('a vacancy that is no initiative application is stored without the field', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }) });
    const v = (await paste(ctx, { text: TEXT })).json().vacancy as Vacancy;
    expect(Object.hasOwn(ctx.vacancyStore.get(v.id) ?? {}, 'initiative')).toBe(false);
  });

  it('link and enough text → the pasted text wins, the page is not opened', async () => {
    const reader = new FakePageReader(() => 'never');
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }), pageReader: reader });
    expect((await paste(ctx, { url: LINK, text: TEXT })).statusCode).toBe(200);
    expect(reader.calls).toEqual([]);
  });

  it('page unreadable → 400 pageUnreadable, no card, no AI run', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }) });
    const res = await paste(ctx, { url: LINK });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'BAD_REQUEST', reason: 'pageUnreadable' });
    expect(ctx.vacancyStore.list()).toEqual([]);
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it('a page with too little text (e.g. a bot wall) → the same pageUnreadable', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ manual: MANUAL }), pageReader: new FakePageReader(() => 'x'.repeat(50)) });
    const res = await paste(ctx, { url: LINK });
    expect(res.json().error).toMatchObject({ code: 'BAD_REQUEST', reason: 'pageUnreadable' });
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it('no browser → BROWSER_MISSING passes through', async () => {
    const ctx = await makeApp({ pageReader: new FakePageReader(() => { throw new AppError('BROWSER_MISSING', 'none'); }) });
    expect((await paste(ctx, { url: LINK })).json().error.code).toBe('BROWSER_MISSING');
  });

  it('an Arbeitsagentur jobdetail link still goes to the API, the page is not opened', async () => {
    const h = hit({ sourceId: '10000-3333333333-S' });
    const ctx = await makeApp({ provider: scoringClaude({ score: () => 50 }), source: fakeSource({ details: () => details(h, 'API-Text') }) });
    expect((await paste(ctx, { url: 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-3333333333-S' })).statusCode).toBe(200);
    expect(ctx.pageReader.calls).toEqual([]);
  });
});

describe('link without text and no AI helper chosen', () => {
  it('answers LLM_NOT_CHOSEN at once, without opening the page', async () => {
    const reader = new FakePageReader(() => 'Stellenangebot '.repeat(40));
    const ctx = await makeApp({ chosen: null, pageReader: reader });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/vacancies/manual', headers: H, payload: { text: '', url: 'https://jobs.example.de/stelle/1' } });
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'LLM_NOT_CHOSEN']);
    expect(reader.calls).toEqual([]);
  });
});

describe('0.9.0: note with an Arbeitsagentur link; initiative in a long pasted text', () => {
  const LINK = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-4444444444-S';
  const h = hit({ sourceId: '10000-4444444444-S', title: 'Webentwickler (m/w/d)', company: 'Beispiel AG' });

  it('a short note next to an Arbeitsagentur link is scored with the offer (inside the offer fence) and stored in front of it', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ score: () => 64 }), source: fakeSource({ details: () => details(h, 'API-Text') }) });
    const v = (await paste(ctx, { url: LINK, text: 'Bitte die Teilzeitstelle' })).json().vacancy as Vacancy;
    expect(ctx.vacancyStore.readText(v.id)).toBe('Notiz: Bitte die Teilzeitstelle\n\nAPI-Text');
    expect(ctx.provider.calls[0].prompt).toMatch(/<<<UNTRUSTED_VACANCY_[0-9a-f]{16}>>>[^<]*Notiz: Bitte die Teilzeitstelle\n\nAPI-Text/);
    expect(ctx.provider.calls[0].prompt).toContain('begins with the person\'s own short note');
  });

  it('without a note the Arbeitsagentur text is stored as is', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ score: () => 64 }), source: fakeSource({ details: () => details(h, 'API-Text') }) });
    const v = (await paste(ctx, { url: LINK })).json().vacancy as Vacancy;
    expect(ctx.vacancyStore.readText(v.id)).toBe('API-Text');
  });

  it('a long pasted text (no link) asking for an initiative application → an initiative card, not NOT_A_VACANCY', async () => {
    const LONG = 'Ich möchte mich initiativ bei der Muster GmbH in Dresden bewerben, als Softwareentwickler. '
      + 'Die Muster GmbH entwickelt Software für den Schienengüterverkehr. '.repeat(5);
    const answer = { ...MANUAL, isVacancy: false, initiative: true, title: 'Initiativbewerbung – Softwareentwickler', contact: { email: '', salutation: '', name: '' } };
    const ctx = await makeApp({ provider: scoringClaude({ manual: answer }) });
    const res = await paste(ctx, { text: LONG });
    expect(res.statusCode).toBe(200);
    expect(res.json().vacancy).toMatchObject({ title: 'Initiativbewerbung – Softwareentwickler', initiative: true });
    expect(ctx.provider.calls[0].prompt).toContain('in their note or anywhere in');
    expect(ctx.provider.calls[0].prompt).not.toContain('UNTRUSTED_PERSON_NOTE');
  });
});
