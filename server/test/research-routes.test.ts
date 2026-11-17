import { describe, it, expect, vi } from 'vitest';
import type { ContactProposal, Vacancy } from '@bp/shared';
import { FakeProvider } from '../src/llm/fake.js';
import { scriptedResponse } from '../src/llm/fake-scripted.js';
import type { LlmTask } from '../src/llm/types.js';
import { H, makeApp } from './helpers/app.js';
import { FakePageReader, vacancy } from './helpers/vacancies.js';

// Every name, address, e-mail and number below is made up.

const LINK = 'https://karriere.muster-digital.example/stelle/7';
const OFFER = 'Frontend Developer (m/w/d) bei der Muster Digital GmbH in Dresden. ' + 'Aufgaben und Profil. '.repeat(20);
const PAGE = `Frontend Developer bei Muster Digital GmbH
Ihr Kontakt
Tel.: +49 351 1234567
E-Mail: karriere@muster-digital.example
Musterstraße 12
01067 Dresden`;
const MANUAL = {
  isVacancy: true, initiative: false, title: 'Frontend Developer (m/w/d)', company: 'Muster Digital GmbH', city: 'Dresden', remote: 'partial',
  employment: ['fulltime'], salaryText: '', contact: { email: '', salutation: '', name: '' }, score: 80, why: ['React'], missing: [],
};

type Ctx = Awaited<ReturnType<typeof makeApp>>;
const call = (ctx: Ctx, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: { ...H, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }) });

/**
 * The pasted-text task answers MANUAL; the company research gets the fake AI's scripted answer (1 fact, 1 red flag);
 * `name` answers the contact-name step (a throw = that AI call fails).
 */
function researchAi(name: () => { salutation: string; name: string } = () => ({ salutation: '', name: '' })): FakeProvider {
  return new FakeProvider({ ok: true }, (task: LlmTask) => {
    const required = (task.schema as { required?: string[] }).required ?? [];
    if (required.includes('isVacancy')) return MANUAL;
    if (task.id === 'contact-name') return name();
    return scriptedResponse(task);
  });
}

/** E-mail and phone, the person only in prose: the parser finds no name, the AI does. */
const PROSE_NAME = `Frontend Developer bei Muster Digital GmbH
Bewerbungen bitte an die Personalabteilung
E-Mail: jobs@muster-digital.example
Tel.: +49 351 7654321
Ansprechpartnerin ist Jana Beispiel aus dem Recruiting.`;

const card = (ctx: Ctx, id: string): Vacancy => ctx.vacancyStore.require(id);
const finished = async (ctx: Ctx, id: string) => {
  await vi.waitFor(() => expect(['done', 'failed']).toContain(card(ctx, id).research?.state));
  return card(ctx, id);
};

describe('company research — automatic start', () => {
  it('manual add returns at once and enqueues research', async () => {
    // The add reads the link (`read`); the research opens pages in a session, which waits until released.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const reader = new FakePageReader(async (url) => {
      if (reader.reads.length > 0 && reader.sessions > 0) await gate;
      return url === LINK ? OFFER : PAGE;
    });
    const ctx = await makeApp({ provider: researchAi(), pageReader: reader });
    const res = await call(ctx, 'POST', '/api/vacancies/manual', { url: LINK });
    expect(res.statusCode).toBe(200);
    const id = (res.json().vacancy as Vacancy).id;
    // The answer came while the research is still in line or reading pages.
    expect(['queued', 'running']).toContain(card(ctx, id).research?.state);
    release();
    const v = await finished(ctx, id);
    expect(v.research).toMatchObject({ state: 'done', provider: 'claude', error: null });
    expect(v.research?.facts).toHaveLength(1);
  });

  it('pasted text without a company name starts no research; with one it does', async () => {
    const ctx = await makeApp({ provider: researchAi() });
    const named = await call(ctx, 'POST', '/api/vacancies/manual', { text: OFFER });
    // MANUAL names the company: a research starts (the pasted text has no link, so only the name is used).
    const namedId = named.json().vacancy.id as string;
    expect(card(ctx, namedId).research).toBeDefined();
    expect((await finished(ctx, namedId)).research?.state).toBe('done');

    const noName = await makeApp({ provider: new FakeProvider({ ok: true }, () => ({ ...MANUAL, company: '' })) });
    const res = await call(noName, 'POST', '/api/vacancies/manual', { text: OFFER });
    expect(res.statusCode).toBe(200);
    expect(card(noName, res.json().vacancy.id).research).toBeUndefined();
  });
});

describe('company research — contact', () => {
  it('filled contact stays, empty fields filled and marked auto; PUT contact clears contactAuto', async () => {
    const ctx = await makeApp({ provider: researchAi(), pageReader: new FakePageReader(() => PAGE) });
    ctx.vacancyStore.add(vacancy({
      id: 'm1', source: 'manual', sourceId: null, company: 'Muster Digital GmbH', url: LINK,
      contact: { email: 'erika@muster-digital.example', salutation: 'Frau', name: 'Erika Musterfrau', phone: '', street: '', postcode: '', city: '' },
    }), OFFER);
    expect((await call(ctx, 'POST', '/api/vacancies/m1/research')).statusCode).toBe(202);
    const v = await finished(ctx, 'm1');
    expect(v.contact).toMatchObject({
      email: 'erika@muster-digital.example', name: 'Erika Musterfrau', phone: '+49 351 1234567', street: 'Musterstraße 12', postcode: '01067', city: 'Dresden',
    });
    expect([...(v.contactAuto ?? [])].sort()).toEqual(['city', 'phone', 'postcode', 'street']);

    const saved = await call(ctx, 'PUT', '/api/vacancies/m1/contact', v.contact);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().vacancy.contactAuto).toBeUndefined();
    expect(card(ctx, 'm1').contactAuto).toBeUndefined();
  });

  it('find contact on a non-AA card returns a proposal and differing, writes nothing', async () => {
    const reader = new FakePageReader(() => PAGE);
    const provider = researchAi();
    const ctx = await makeApp({ provider, pageReader: reader });
    const contact = { email: 'erika@muster-digital.example', salutation: 'Frau' as const, name: 'Erika Musterfrau', phone: '', street: '', postcode: '', city: '' };
    ctx.vacancyStore.add(vacancy({ id: 'm1', source: 'manual', sourceId: null, company: 'Muster Digital GmbH', url: LINK, contact }), OFFER);
    const before = card(ctx, 'm1');
    const res = await call(ctx, 'POST', '/api/vacancies/m1/contact/find', { from: 'partner' });
    expect(res.statusCode).toBe(200);
    const p = res.json() as ContactProposal;
    expect(p.proposal).toMatchObject({ email: 'karriere@muster-digital.example', phone: '+49 351 1234567', city: 'Dresden' });
    expect(p.found).toEqual(expect.arrayContaining(['email', 'phone', 'street', 'postcode', 'city']));
    expect(p.differing).toEqual({ email: 'karriere@muster-digital.example' });
    expect(reader.sessions).toBe(1);
    expect(reader.calls[0]).toBe(LINK);
    // A proposal only: the card, its contact and its research are as before; no news and no AI summary.
    expect(card(ctx, 'm1')).toEqual(before);
    expect(provider.calls.filter((c) => c.id === 'company-research')).toEqual([]);
  });

  it('find contact: a name found only by the AI comes with the proposal; the research marks it auto', async () => {
    const provider = researchAi(() => ({ salutation: 'Frau', name: 'Jana Beispiel' }));
    const ctx = await makeApp({ provider, pageReader: new FakePageReader(() => PROSE_NAME) });
    ctx.vacancyStore.add(vacancy({ id: 'm1', source: 'manual', sourceId: null, company: 'Muster Digital GmbH', url: LINK }), OFFER);
    const res = await call(ctx, 'POST', '/api/vacancies/m1/contact/find', { from: 'partner' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ContactProposal).proposal).toMatchObject({ email: 'jobs@muster-digital.example', salutation: 'Frau', name: 'Jana Beispiel' });
    const nameCalls = provider.calls.filter((c) => c.id === 'contact-name');
    expect(nameCalls).toHaveLength(1);
    expect(nameCalls[0].prompt).toContain('Jana Beispiel');
    expect(card(ctx, 'm1').contact).toBeNull();

    await call(ctx, 'POST', '/api/vacancies/m1/research');
    const v = await finished(ctx, 'm1');
    expect(v.contact).toMatchObject({ email: 'jobs@muster-digital.example', salutation: 'Frau', name: 'Jana Beispiel' });
    expect(v.contactAuto).toEqual(expect.arrayContaining(['email', 'name', 'salutation', 'phone']));
  });

  it('find contact / research: a failing name step never fails them — the contact comes without a name', async () => {
    const provider = researchAi(() => { throw new Error('AI down'); });
    const ctx = await makeApp({ provider, pageReader: new FakePageReader(() => PROSE_NAME) });
    ctx.vacancyStore.add(vacancy({ id: 'm1', source: 'manual', sourceId: null, company: 'Muster Digital GmbH', url: LINK }), OFFER);
    const res = await call(ctx, 'POST', '/api/vacancies/m1/contact/find', { from: 'partner' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ContactProposal).proposal).toMatchObject({ email: 'jobs@muster-digital.example', name: '', salutation: '' });

    await call(ctx, 'POST', '/api/vacancies/m1/research');
    const v = await finished(ctx, 'm1');
    expect(v.research?.state).toBe('done');
    expect(v.contact).toMatchObject({ email: 'jobs@muster-digital.example', name: '' });
  });

  it('find contact: the AA window is only for Arbeitsagentur offers', async () => {
    const ctx = await makeApp();
    ctx.vacancyStore.add(vacancy({ id: 'm1', source: 'manual', sourceId: null, url: LINK }), OFFER);
    expect((await call(ctx, 'POST', '/api/vacancies/m1/contact/find', { from: 'aa' })).statusCode).toBe(400);
  });
});

describe('company research — facts, website, stop', () => {
  // The plan pins this: a new run brings new facts, so a hidden mark is NOT carried over — not even to a fact with the
  // same text. Hiding is kept only on the fact (the same id) the person hid.
  it('PATCH fact hidden is kept after a re-research only for the same text', async () => {
    const ctx = await makeApp({ provider: researchAi(), pageReader: new FakePageReader(() => PAGE) });
    ctx.vacancyStore.add(vacancy({ id: 'm1', source: 'manual', sourceId: null, company: 'Muster Digital GmbH', url: LINK }), OFFER);
    await call(ctx, 'POST', '/api/vacancies/m1/research');
    const first = (await finished(ctx, 'm1')).research?.facts[0];
    expect(first).toBeDefined();
    const hid = await call(ctx, 'PATCH', `/api/vacancies/m1/research/facts/${first?.id}`, { hidden: true });
    expect(hid.statusCode).toBe(200);
    expect(hid.json().vacancy.research.facts[0]).toMatchObject({ id: first?.id, hidden: true });
    expect(card(ctx, 'm1').research?.facts[0].hidden).toBe(true);

    await call(ctx, 'POST', '/api/vacancies/m1/research');
    await vi.waitFor(() => expect(card(ctx, 'm1').research?.facts[0]?.id).not.toBe(first?.id));
    const again = (await finished(ctx, 'm1')).research?.facts[0];
    expect(again?.text).toBe(first?.text);
    expect(again?.hidden).toBeUndefined();

    expect((await call(ctx, 'PATCH', '/api/vacancies/m1/research/facts/nope', { hidden: true })).statusCode).toBe(404);
  });

  it('PUT website with an internal address → 400', async () => {
    const ctx = await makeApp({ provider: researchAi(), pageReader: new FakePageReader(() => PAGE) });
    ctx.vacancyStore.add(vacancy({ id: 'm1', source: 'manual', sourceId: null, company: 'Muster Digital GmbH', url: '' }), OFFER);
    for (const url of ['http://127.0.0.1:8080/', 'http://localhost/', 'http://192.168.1.1/', 'ftp://muster.example/', 'https://user:pw@muster.example/']) {
      const res = await call(ctx, 'PUT', '/api/vacancies/m1/research/website', { url });
      expect([url, res.statusCode]).toEqual([url, 400]);
    }
    expect(card(ctx, 'm1').research).toBeUndefined();

    // A hidden card: refused before anything is saved.
    ctx.vacancyStore.add(vacancy({ id: 'h1', source: 'manual', sourceId: null, status: 'hidden', url: '' }), OFFER);
    const hidden = await call(ctx, 'PUT', '/api/vacancies/h1/research/website', { url: 'https://www.muster-digital.example/' });
    expect(hidden.statusCode).toBe(409);
    expect(card(ctx, 'h1').research).toBeUndefined();

    const ok = await call(ctx, 'PUT', '/api/vacancies/m1/research/website', { url: 'https://www.muster-digital.example/ueber-uns' });
    expect(ok.statusCode).toBe(202);
    const v = await finished(ctx, 'm1');
    expect(v.research).toMatchObject({ state: 'done', website: 'https://www.muster-digital.example', websiteByPerson: true });
  });

  it('DELETE stops a running research: failed with LLM_CANCELLED, nothing else written', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const reader = new FakePageReader(async () => { await gate; return PAGE; });
    const ctx = await makeApp({ provider: researchAi(), pageReader: reader });
    ctx.vacancyStore.add(vacancy({ id: 'm1', source: 'manual', sourceId: null, company: 'Muster Digital GmbH', url: LINK }), OFFER);
    await call(ctx, 'POST', '/api/vacancies/m1/research');
    await vi.waitFor(() => expect(card(ctx, 'm1').research?.state).toBe('running'));
    const res = await call(ctx, 'DELETE', '/api/vacancies/m1/research');
    expect(res.statusCode).toBe(200);
    expect(res.json().vacancy.research).toMatchObject({ state: 'failed', error: 'LLM_CANCELLED' });
    release();
    await vi.waitFor(() => expect(reader.closed).toBe(1));
    expect(card(ctx, 'm1').research).toMatchObject({ state: 'failed', error: 'LLM_CANCELLED', facts: [] });
    expect(card(ctx, 'm1').contact).toBeNull();
  });

  it('a running research makes a restore wait (restoreBusyAi)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const ctx = await makeApp({ provider: researchAi(), pageReader: new FakePageReader(async () => { await gate; return PAGE; }) });
    ctx.vacancyStore.add(vacancy({ id: 'm1', source: 'manual', sourceId: null, company: 'Muster Digital GmbH', url: LINK }), OFFER);
    const made = (await call(ctx, 'POST', '/api/backups')).json() as { name: string };
    await call(ctx, 'POST', '/api/vacancies/m1/research');
    await vi.waitFor(() => expect(card(ctx, 'm1').research?.state).toBe('running'));
    const res = await call(ctx, 'POST', '/api/backups/restore', { name: made.name });
    expect([res.statusCode, res.json().error?.reason]).toEqual([409, 'restoreBusyAi']);
    release();
    await finished(ctx, 'm1');
  });
});
