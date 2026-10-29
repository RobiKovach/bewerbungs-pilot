import { describe, it, expect } from 'vitest';
import type { ApplicationJobState, ApplicationView, ContactProposal, Vacancy } from '@bp/shared';
import { AppError } from '../src/errors.js';
import { FakeProvider } from '../src/llm/fake.js';
import type { LlmTask } from '../src/llm/types.js';
import type { Logger } from '../src/log.js';
import { H, makeApp } from './helpers/app.js';
import { packageClaude, readyPackageProfile } from './helpers/applications.js';
import { FakeContactWindow, FakePageReader, vacancy } from './helpers/vacancies.js';

// Every name, address, e-mail and number below is made up; the AA block follows the layout of the B1 live checks.

const AA_BLOCK = `Stellenangebot: Webentwickler (m/w/d)
Stellenbeschreibung
Wir suchen Verstärkung für unser Team.
Informationen zur Bewerbung
Kontaktadresse
Muster Digital GmbH
Erika Musterfrau
E-Mail: bewerbung@muster-digital.example
Bewerben Sie sich:
Über Internetseite des Arbeitgebers
Bitte bewerben Sie sich unter Angabe unserer internen Stellennummer: JN -0012345678`;

const AA_LINK_ONLY = `Stellenangebot: Webentwickler (m/w/d)
Informationen zur Bewerbung
Bewerben Sie sich:
Über Internetseite des Arbeitgebers`;

const PARTNER_PAGE = `Karriere bei Muster Digital
Kontakt
Ihr Ansprechpartner: Herr Max Beispielmann
Tel.: +49 351 1234567
E-Mail: karriere@muster-digital.example
Musterstraße 12
01067 Dresden`;

/** E-mail and phone, but the person's name stands alone above the e-mail only in the AI's eyes. */
const NO_NAME = `Bewerbungen bitte an
Personalabteilung
E-Mail: jobs@firma.example
Ansprechpartnerin ist Jana Beispiel aus dem Recruiting.`;

const CONTACT = { email: 'bewerbung@muster-digital.example', salutation: 'Frau', name: 'Erika Musterfrau', phone: '+49 351 7654321', street: 'Musterweg 3', postcode: '01069', city: 'Dresden' } as const;

type Ctx = Awaited<ReturnType<typeof makeApp>>;
const send = (ctx: Ctx, method: 'POST' | 'PUT', url: string, payload: unknown) =>
  ctx.app.inject({ method, url, headers: { ...H, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
const find = (ctx: Ctx, id: string, from: string) => send(ctx, 'POST', `/api/vacancies/${id}/contact/find`, { from });

function recordingLogger(): Logger & { lines: unknown[] } {
  const lines: unknown[] = [];
  const rec = (event: string, data?: Record<string, unknown>) => { lines.push({ event, data }); };
  return { lines, info: rec, warn: rec, error: rec };
}

/** Answers only the contact-name task; `name` decides the AI's answer (a thrown error = the AI failed). */
function nameClaude(name: (task: LlmTask) => { salutation: string; name: string }): FakeProvider {
  return new FakeProvider({ ok: true }, (task) => {
    if (task.id !== 'contact-name') throw new Error(`unexpected task ${task.id}`);
    return name(task);
  });
}

describe('POST /api/vacancies/:id/contact/find — Arbeitsagentur window', () => {
  it('reads the AA block into a proposal; nothing is saved', async () => {
    const contactWindow = new FakeContactWindow(() => ({ text: AA_BLOCK, links: [] }));
    const ctx = await makeApp({ contactWindow });
    const v = ctx.vacancyStore.add(vacancy({ id: 'aa1' }), 'Text');
    const res = await find(ctx, 'aa1', 'aa');
    expect(res.statusCode).toBe(200);
    const body = res.json() as ContactProposal;
    expect(body.proposal).toMatchObject({ email: 'bewerbung@muster-digital.example', name: 'Erika Musterfrau' });
    expect(body.found).toEqual(expect.arrayContaining(['email', 'name']));
    expect(body.proposal.phone).toBe('');
    expect(contactWindow.calls).toEqual([v.sourceId]);
    expect(ctx.vacancyStore.require('aa1').contact).toBeNull();
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it('the person closed the window → { cancelled: true }', async () => {
    const ctx = await makeApp({ contactWindow: new FakeContactWindow(() => ({ cancelled: true })) });
    ctx.vacancyStore.add(vacancy({ id: 'aa1' }), 'Text');
    const res = await find(ctx, 'aa1', 'aa');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cancelled: true });
  });

  it('a pasted (manual) vacancy cannot open the AA window → 400, the window is never opened', async () => {
    const contactWindow = new FakeContactWindow(() => ({ text: AA_BLOCK, links: [] }));
    const ctx = await makeApp({ contactWindow });
    ctx.vacancyStore.add(vacancy({ id: 'm1', source: 'manual', sourceId: null, url: '' }), 'Text');
    const res = await find(ctx, 'm1', 'aa');
    expect(res.statusCode).toBe(400);
    expect(contactWindow.calls).toEqual([]);
  });

  it('only a link to the employer site → that page is read headless and parsed', async () => {
    const pageReader = new FakePageReader(() => PARTNER_PAGE);
    const links = ['https://www.arbeitsagentur.de/kontakt', 'https://karriere.muster-digital.example/jobs'];
    const ctx = await makeApp({ pageReader, contactWindow: new FakeContactWindow(() => ({ text: AA_LINK_ONLY, links })) });
    ctx.vacancyStore.add(vacancy({ id: 'aa1' }), 'Text');
    const res = await find(ctx, 'aa1', 'aa');
    expect(res.statusCode).toBe(200);
    expect(pageReader.calls).toEqual(['https://karriere.muster-digital.example/jobs']);
    expect((res.json() as ContactProposal).proposal).toMatchObject({
      salutation: 'Herr', name: 'Max Beispielmann', email: 'karriere@muster-digital.example', phone: '+49 351 1234567', street: 'Musterstraße 12', postcode: '01067', city: 'Dresden',
    });
  });

  it('links only on the AA site are never read; an unreadable employer page → an empty proposal (the paste fallback)', async () => {
    const pageReader = new FakePageReader(() => { throw new AppError('BAD_REQUEST', 'fake: unreadable', 'pageUnreadable'); });
    const ctx = await makeApp({ pageReader, contactWindow: new FakeContactWindow(() => ({ text: AA_LINK_ONLY, links: ['https://www.arbeitsagentur.de/x'] })) });
    ctx.vacancyStore.add(vacancy({ id: 'aa1' }), 'Text');
    const onlyAa = await find(ctx, 'aa1', 'aa');
    expect(onlyAa.json()).toMatchObject({ found: [] });
    expect(pageReader.calls).toEqual([]);

    const ctx2 = await makeApp({ pageReader, contactWindow: new FakeContactWindow(() => ({ text: AA_LINK_ONLY, links: ['https://firma.example/'] })) });
    ctx2.vacancyStore.add(vacancy({ id: 'aa2' }), 'Text');
    const res = await find(ctx2, 'aa2', 'aa');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ found: [], proposal: { email: '', phone: '', name: '' } });
  });

  it('window errors pass through (no browser → BROWSER_MISSING)', async () => {
    const ctx = await makeApp({ contactWindow: new FakeContactWindow(() => { throw new AppError('BROWSER_MISSING', 'no Edge'); }) });
    ctx.vacancyStore.add(vacancy({ id: 'aa1' }), 'Text');
    expect((await find(ctx, 'aa1', 'aa')).json().error.code).toBe('BROWSER_MISSING');
  });
});

describe('POST /api/vacancies/:id/contact/find — partner page', () => {
  it('reads partnerUrl with the headless reader', async () => {
    const pageReader = new FakePageReader(() => PARTNER_PAGE);
    const ctx = await makeApp({ pageReader });
    ctx.vacancyStore.add(vacancy({ id: 'p1', partnerUrl: 'https://karriere.muster-digital.example/stelle' }), 'Text');
    const res = await find(ctx, 'p1', 'partner');
    expect(res.statusCode).toBe(200);
    expect(pageReader.calls).toEqual(['https://karriere.muster-digital.example/stelle']);
    expect((res.json() as ContactProposal).proposal.email).toBe('karriere@muster-digital.example');
  });

  it('no partner page → 400; a partner page on an internal address → refused before any browser', async () => {
    const pageReader = new FakePageReader(() => PARTNER_PAGE);
    const ctx = await makeApp({ pageReader });
    ctx.vacancyStore.add(vacancy({ id: 'p0' }), 'Text');
    expect((await find(ctx, 'p0', 'partner')).statusCode).toBe(400);
    ctx.vacancyStore.add(vacancy({ id: 'p2', partnerUrl: 'http://127.0.0.1:8080/admin' }), 'Text');
    const res = await find(ctx, 'p2', 'partner');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.reason).toBe('pageUnreadable');
    expect(pageReader.calls).toEqual([]);
  });

  it('an unknown "from" → 400', async () => {
    const ctx = await makeApp();
    ctx.vacancyStore.add(vacancy({ id: 'p1' }), 'Text');
    expect((await find(ctx, 'p1', 'google')).statusCode).toBe(400);
  });
});

describe('POST /api/vacancies/:id/contact/parse — pasted text', () => {
  it('turns pasted text into a proposal without saving', async () => {
    const ctx = await makeApp();
    ctx.vacancyStore.add(vacancy({ id: 'v1' }), 'Text');
    const res = await send(ctx, 'POST', '/api/vacancies/v1/contact/parse', { text: PARTNER_PAGE });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ContactProposal).proposal).toMatchObject({ name: 'Max Beispielmann', salutation: 'Herr' });
    expect(ctx.vacancyStore.require('v1').contact).toBeNull();
  });

  it('empty or longer than 20 000 characters → 400', async () => {
    const ctx = await makeApp();
    ctx.vacancyStore.add(vacancy({ id: 'v1' }), 'Text');
    expect((await send(ctx, 'POST', '/api/vacancies/v1/contact/parse', { text: '' })).statusCode).toBe(400);
    expect((await send(ctx, 'POST', '/api/vacancies/v1/contact/parse', { text: 'a'.repeat(20_001) })).statusCode).toBe(400);
  });
});

describe('the AI is asked only for a missing name', () => {
  it('an e-mail without a name → the AI names the person; a name it made up is dropped', async () => {
    const provider = nameClaude(() => ({ salutation: 'Frau', name: 'Jana Beispiel' }));
    const ctx = await makeApp({ provider });
    ctx.vacancyStore.add(vacancy({ id: 'v1' }), 'Text');
    const res = await send(ctx, 'POST', '/api/vacancies/v1/contact/parse', { text: NO_NAME });
    expect((res.json() as ContactProposal).proposal).toMatchObject({ email: 'jobs@firma.example', name: 'Jana Beispiel', salutation: 'Frau' });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].prompt.length).toBeLessThan(4000);

    const liar = await makeApp({ provider: nameClaude(() => ({ salutation: 'Herr', name: 'Hans Erfunden' })) });
    liar.vacancyStore.add(vacancy({ id: 'v1' }), 'Text');
    const r2 = await send(liar, 'POST', '/api/vacancies/v1/contact/parse', { text: NO_NAME });
    expect((r2.json() as ContactProposal).proposal).toMatchObject({ email: 'jobs@firma.example', name: '', salutation: '' });
  });

  it('a name found by the parser → no AI call; an AI failure or no AI chosen → the proposal still comes, without a name', async () => {
    const provider = nameClaude(() => { throw new Error('boom'); });
    const ctx = await makeApp({ provider });
    ctx.vacancyStore.add(vacancy({ id: 'v1' }), 'Text');
    await send(ctx, 'POST', '/api/vacancies/v1/contact/parse', { text: PARTNER_PAGE });
    expect(provider.calls).toHaveLength(0);
    const failed = await send(ctx, 'POST', '/api/vacancies/v1/contact/parse', { text: NO_NAME });
    expect(failed.statusCode).toBe(200);
    expect((failed.json() as ContactProposal).proposal).toMatchObject({ email: 'jobs@firma.example', name: '' });

    const none = await makeApp({ chosen: null });
    none.vacancyStore.add(vacancy({ id: 'v1' }), 'Text');
    const r = await send(none, 'POST', '/api/vacancies/v1/contact/parse', { text: NO_NAME });
    expect(r.statusCode).toBe(200);
    expect((r.json() as ContactProposal).proposal.email).toBe('jobs@firma.example');
  });
});

describe('PUT /api/vacancies/:id/contact', () => {
  it('saves the contact on any vacancy (AA too), trimmed; null or all empty clears it', async () => {
    const ctx = await makeApp();
    ctx.vacancyStore.add(vacancy({ id: 'aa1' }), 'Text');
    const res = await send(ctx, 'PUT', '/api/vacancies/aa1/contact', { ...CONTACT, name: '  Erika   Musterfrau ' });
    expect(res.statusCode).toBe(200);
    expect((res.json().vacancy as Vacancy).contact).toEqual({ ...CONTACT });
    expect(ctx.vacancyStore.require('aa1').contact).toEqual({ ...CONTACT });

    await send(ctx, 'PUT', '/api/vacancies/aa1/contact', { email: ' ', salutation: 'Frau', name: '', phone: '', street: '', postcode: '', city: '' });
    expect(ctx.vacancyStore.require('aa1').contact).toBeNull();
    await send(ctx, 'PUT', '/api/vacancies/aa1/contact', CONTACT);
    expect((await send(ctx, 'PUT', '/api/vacancies/aa1/contact', null)).statusCode).toBe(200);
    expect(ctx.vacancyStore.require('aa1').contact).toBeNull();
  });

  it('too long → 400; an unknown field is dropped, never stored', async () => {
    const ctx = await makeApp();
    ctx.vacancyStore.add(vacancy({ id: 'aa1' }), 'Text');
    expect((await send(ctx, 'PUT', '/api/vacancies/aa1/contact', { ...CONTACT, phone: '1'.repeat(41) })).statusCode).toBe(400);
    await send(ctx, 'PUT', '/api/vacancies/aa1/contact', { ...CONTACT, extra: 'x' });
    expect(ctx.vacancyStore.require('aa1').contact).toEqual({ ...CONTACT });
  });
});

describe('PUT /api/applications/:id/contact', () => {
  async function created(): Promise<{ ctx: Ctx; id: string }> {
    const ctx = await makeApp({ provider: packageClaude() });
    ctx.profileStore.update((p) => { Object.assign(p, readyPackageProfile()); });
    ctx.vacancyStore.add(vacancy({ id: 'fav1', status: 'favorite', company: 'Muster GmbH', locations: ['Hamburg'] }),
      'Wir suchen einen Webentwickler (m/w/d) für unser Team in Hamburg. Sie bauen mit uns Online-Shops für den Handel. '.repeat(8));
    await send(ctx, 'POST', '/api/applications', { vacancyId: 'fav1', language: 'de' });
    await ctx.applicationJob.whenIdle();
    const state = (await ctx.app.inject({ method: 'GET', url: '/api/applications/job' })).json() as ApplicationJobState;
    return { ctx, id: state.applicationId! };
  }

  it('saves the contact in the package and on the card, rebuilds address and salutation, recounts, approved → draft', async () => {
    const { ctx, id } = await created();
    await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    ctx.printer.pagesFor = () => 1;
    const res = await send(ctx, 'PUT', `/api/applications/${id}/contact`, CONTACT);
    expect(res.statusCode).toBe(200);
    const p = (res.json() as ApplicationView).application;
    expect(p.vacancy.contact).toEqual({ ...CONTACT });
    expect(p.letter.recipient).toEqual(['Muster GmbH', 'Frau Erika Musterfrau', 'Musterweg 3', '01069 Dresden']);
    expect(p.letter.salutation).toBe('Sehr geehrte Frau Musterfrau,');
    expect(p.letter.pages).toBe(1);
    expect(p.status).toBe('draft');
    expect(ctx.vacancyStore.require('fav1').contact).toEqual({ ...CONTACT });

    const cleared = (await send(ctx, 'PUT', `/api/applications/${id}/contact`, null)).json() as ApplicationView;
    expect(cleared.application.letter.salutation).toBe('Sehr geehrte Damen und Herren,');
    expect(cleared.application.letter.recipient).toEqual(['Muster GmbH', 'Hamburg']);
  });

  it('a sent package refuses (409 packageSent), nothing changes', async () => {
    const { ctx, id } = await created();
    ctx.applicationStore.update(id, (p) => { p.status = 'sent'; p.history.push({ kind: 'sent', at: '2026-10-05T10:00:00.000Z' }); });
    const res = await send(ctx, 'PUT', `/api/applications/${id}/contact`, CONTACT);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.reason).toBe('packageSent');
    expect(ctx.applicationStore.require(id).vacancy.contact).toBeNull();
    expect(ctx.vacancyStore.require('fav1').contact).toBeNull();
  });
});

describe('logs', () => {
  it('only where it looked and how it ended — never names, e-mails, phones, addresses or links', async () => {
    const logger = recordingLogger();
    const pageReader = new FakePageReader(() => PARTNER_PAGE);
    const ctx = await makeApp({ logger, pageReader, provider: nameClaude(() => ({ salutation: 'Frau', name: 'Jana Beispiel' })) });
    ctx.vacancyStore.add(vacancy({ id: 'p1', partnerUrl: 'https://karriere.muster-digital.example/stelle' }), 'Text');
    await find(ctx, 'p1', 'partner');
    await send(ctx, 'POST', '/api/vacancies/p1/contact/parse', { text: NO_NAME });
    await send(ctx, 'POST', '/api/vacancies/p1/contact/parse', { text: 'nichts hier' });
    const finds = logger.lines.filter((l) => (l as { event: string }).event === 'vacancy.contactFind').map((l) => (l as { data: unknown }).data);
    expect(finds).toEqual([{ source: 'partner', result: 'ok' }, { source: 'paste', result: 'ok' }, { source: 'paste', result: 'none' }]);
    const all = JSON.stringify(logger.lines);
    for (const secret of ['Beispielmann', 'karriere@', 'jobs@', '1234567', 'Musterstraße', '01067', 'Jana', 'muster-digital.example/stelle']) {
      expect(all).not.toContain(secret);
    }
  });
});
