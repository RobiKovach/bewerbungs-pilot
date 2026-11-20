import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { ApplicationJobState, ApplicationView, CompanyResearch, VacancyContact } from '@bp/shared';
import { ApplicationJob } from '../src/applications/job.js';
import { allowedFor } from '../src/applications/personal-data.js';
import { ApplicationStore } from '../src/applications/store.js';
import { LlmQueue } from '../src/llm/queue.js';
import { nullLogger } from '../src/log.js';
import { VacancyStore } from '../src/vacancies/store.js';
import { H, makeApp } from './helpers/app.js';
import { FakePrinter, packageClaude, pkg, readyPackageProfile } from './helpers/applications.js';
import { vacancy } from './helpers/vacancies.js';

// Every company, address and fact below is made up.
const OFFER = 'Wir suchen einen Webentwickler (m/w/d) für unser Team in Hamburg. Sie bauen Online-Shops mit uns.';
const RULE = 'Facts about the company (optional): you may use one or two of them for a concrete "why this company" sentence. Use only these facts, never invent others, never mention anything negative about the company.';
const FACT_A = 'Baut seit 2015 Online-Shops für den Handel in Norddeutschland.';
const FACT_B = 'Hat 2026 einen zweiten Standort in Kiel eröffnet.';
const FACT_C = 'Entwickelt eine eigene Plattform für Lieferdienste.';
const FLAG = 'Mehrere Bewertungen berichten von unbezahlten Überstunden.';

function research(facts: { text: string; hidden?: boolean }[], over: Partial<CompanyResearch> = {}): CompanyResearch {
  return {
    state: 'done', startedAt: '2026-11-17T09:00:00.000Z', finishedAt: '2026-11-17T09:01:00.000Z', provider: 'claude', language: 'de',
    website: 'https://muster-shop.example', websiteByPerson: false, about: 'Online-Shops.', news: [], newsFailed: false,
    redFlags: [{ id: 'r1', text: FLAG, sourceUrl: 'https://muster-shop.example/' }],
    facts: facts.map((f, i) => ({ id: `f${i + 1}`, text: f.text, sourceUrl: 'https://muster-shop.example/', ...(f.hidden ? { hidden: true } : {}) })),
    sources: [{ url: 'https://muster-shop.example/', kind: 'home' }], error: null, ...over,
  };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp facts-'));
  const store = new ApplicationStore(path.join(dir, 'applications'));
  store.load();
  const vacancies = new VacancyStore({ file: path.join(dir, 'vacancies', 'vacancies.json'), textsDir: path.join(dir, 'vacancies', 'texts') });
  vacancies.load();
  const provider = packageClaude();
  let ids = 0;
  const job = new ApplicationJob({
    store, vacancies, queue: new LlmQueue(provider), printer: new FakePrinter(), logger: nullLogger,
    profile: () => readyPackageProfile(), photo: () => null, stateFile: path.join(dir, 'applications', 'job-state.json'),
    newId: () => `app${++ids}`, now: () => new Date('2026-11-17T10:00:00.000Z'),
  });
  job.init();
  return { store, vacancies, provider, job };
}

describe('0.13.0: company facts in the letter', () => {
  it('create package snapshots non-hidden facts only; red flags never reach the prompt', async () => {
    const t = setup();
    t.vacancies.add(vacancy({ id: 'fav1', status: 'favorite', company: 'Muster Shop GmbH', locations: ['Hamburg'], research: research([{ text: FACT_A }, { text: FACT_B, hidden: true }]) }), OFFER);
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    expect(t.job.state().state).toBe('done');
    const p = t.store.require('app1');
    expect(p.vacancy.facts).toEqual([FACT_A]);
    const prompt = t.provider.calls[0].prompt;
    expect(prompt).toContain(RULE);
    expect(prompt).toMatch(/<<<UNTRUSTED_COMPANY_FACTS_[0-9a-f]{16}>>>[\s\S]*Baut seit 2015/);
    expect(prompt).not.toContain(FACT_B);
    expect(prompt).not.toContain(FLAG);
    expect(prompt).not.toContain('unbezahlten');
  });

  it('revise uses the snapshot facts; create again takes the current ones', async () => {
    const t = setup();
    t.vacancies.add(vacancy({ id: 'fav1', status: 'favorite', company: 'Muster Shop GmbH', locations: ['Hamburg'], research: research([{ text: FACT_A }]) }), OFFER);
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    t.vacancies.update('fav1', (v) => { v.research = research([{ text: FACT_C }]); });

    t.job.start({ kind: 'revise', applicationId: 'app1', instruction: 'Bitte kürzer' });
    await t.job.whenIdle();
    expect(t.job.state().state).toBe('done');
    const revised = t.provider.calls.at(-1)!.prompt;
    expect(revised).toContain(FACT_A);
    expect(revised).not.toContain(FACT_C);
    expect(t.store.require('app1').vacancy.facts).toEqual([FACT_A]);

    t.job.start({ kind: 'recreate', applicationId: 'app1', language: 'de' });
    await t.job.whenIdle();
    expect(t.job.state().state).toBe('done');
    const recreated = t.provider.calls.at(-1)!.prompt;
    expect(recreated).toContain(FACT_C);
    expect(recreated).not.toContain(FACT_A);
    expect(t.store.require('app1').vacancy.facts).toEqual([FACT_C]);
  });

  it('no research → prompt has no facts block', async () => {
    const t = setup();
    t.vacancies.add(vacancy({ id: 'fav1', status: 'favorite', company: 'Muster Shop GmbH', locations: ['Hamburg'] }), OFFER);
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    const prompt = t.provider.calls[0].prompt;
    expect(prompt).not.toContain('Facts about the company');
    expect(prompt).not.toContain('COMPANY_FACTS');
    expect(Object.hasOwn(t.store.require('app1').vacancy, 'facts')).toBe(false);
    expect(Object.hasOwn(t.store.require('app1').vacancy, 'contactAuto')).toBe(false);
  });
});

describe('0.13.0: auto contact in packages', () => {
  it('auto e-mail is not allowed in allowedFor until confirmed', () => {
    const contact: VacancyContact = { email: 'jobs@muster-shop.example', salutation: '', name: '', phone: '+49 40 1234567', street: '', postcode: '', city: '' };
    const auto = pkg({ vacancy: { id: 'v1', title: 'Webentwickler', company: 'Muster Shop GmbH', locations: ['Hamburg'], remote: 'no', url: '', contact, contactAuto: ['email', 'phone'] } });
    const a = allowedFor(auto, readyPackageProfile(), null);
    expect(a.emails).not.toContain('jobs@muster-shop.example');
    expect(a.phones.some((x) => x.includes('401234567'))).toBe(false);

    const confirmed = structuredClone(auto);
    delete confirmed.vacancy.contactAuto;
    const b = allowedFor(confirmed, readyPackageProfile(), null);
    expect(b.emails).toContain('jobs@muster-shop.example');
    expect(b.phones.some((x) => x.includes('401234567'))).toBe(true);
  });

  type Ctx = Awaited<ReturnType<typeof makeApp>>;
  const send = (ctx: Ctx, method: 'POST' | 'PUT', url: string, payload: unknown) =>
    ctx.app.inject({ method, url, headers: { ...H, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  const getView = async (ctx: Ctx, id: string) => (await ctx.app.inject({ method: 'GET', url: `/api/applications/${id}`, headers: H })).json() as ApplicationView;

  async function created(over: Parameters<typeof vacancy>[0] = {}): Promise<{ ctx: Ctx; id: string }> {
    const ctx = await makeApp({ provider: packageClaude() });
    ctx.profileStore.update((p) => { Object.assign(p, readyPackageProfile()); });
    ctx.vacancyStore.add(vacancy({ id: 'fav1', status: 'favorite', company: 'Muster Shop GmbH', locations: ['Hamburg'], ...over }), OFFER.repeat(6));
    await send(ctx, 'POST', '/api/applications', { vacancyId: 'fav1', language: 'de' });
    await ctx.applicationJob.whenIdle();
    const state = (await ctx.app.inject({ method: 'GET', url: '/api/applications/job', headers: H })).json() as ApplicationJobState;
    return { ctx, id: state.applicationId! };
  }

  it('factsChanged true when research finished after the package', async () => {
    const { ctx, id } = await created();
    expect((await getView(ctx, id)).factsChanged).toBe(false);
    ctx.vacancyStore.update('fav1', (v) => { v.research = research([{ text: FACT_A }]); });
    expect((await getView(ctx, id)).factsChanged).toBe(true);
    // The person hides the only fact: the card's facts equal the package's (none) again.
    ctx.vacancyStore.update('fav1', (v) => { v.research = research([{ text: FACT_A, hidden: true }]); });
    expect((await getView(ctx, id)).factsChanged).toBe(false);
  });

  it('recipientAuto shows the domain; PUT contact clears it', async () => {
    const contact: VacancyContact = { email: 'Jobs@Muster-Shop.example', salutation: '', name: '', phone: '', street: '', postcode: '', city: '' };
    const { ctx, id } = await created({ contact, contactAuto: ['email'] });
    const before = await getView(ctx, id);
    expect(before.application.vacancy.contactAuto).toEqual(['email']);
    expect(before.recipientAuto).toEqual({ domain: 'muster-shop.example' });

    const res = await send(ctx, 'PUT', `/api/applications/${id}/contact`, { ...contact, email: 'jobs@muster-shop.example' });
    expect(res.statusCode).toBe(200);
    const after = res.json() as ApplicationView;
    expect(after.recipientAuto).toBeNull();
    expect(Object.hasOwn(after.application.vacancy, 'contactAuto')).toBe(false);
    expect(Object.hasOwn(ctx.vacancyStore.require('fav1'), 'contactAuto')).toBe(false);
  });
});
