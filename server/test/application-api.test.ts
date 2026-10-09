import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { ApplicationJobState, ApplicationView, Profile } from '@bp/shared';
import { H, makeApp } from './helpers/app.js';
import { FakePrinter, GOOD_LETTER, packageClaude, readyPackageProfile } from './helpers/applications.js';
import { vacancy } from './helpers/vacancies.js';
import { makePdf } from './helpers/applications.js';

const OFFER_DE = 'Wir suchen einen Webentwickler (m/w/d) für unser Team in Hamburg. Sie bauen mit uns Online-Shops für den Handel. '.repeat(8);
const OFFER_EN = 'We are looking for a web developer to join our team. You will build online shops with us and our clients. '.repeat(8);
const DOC_ID = '11111111-2222-4333-8444-555555555555';

type Ctx = Awaited<ReturnType<typeof makeApp>>;
async function setup(opts: { provider?: ReturnType<typeof packageClaude>; printer?: FakePrinter; profile?: (p: Profile) => void } = {}) {
  const ctx = await makeApp({ provider: opts.provider ?? packageClaude(), printer: opts.printer });
  ctx.profileStore.update((p) => { Object.assign(p, readyPackageProfile(opts.profile)); });
  ctx.vacancyStore.add(vacancy({ id: 'fav1', status: 'favorite', company: 'Muster GmbH', locations: ['Hamburg'] }), OFFER_DE);
  return ctx;
}
const get = (ctx: Ctx, url: string) => ctx.app.inject({ method: 'GET', url });
const send = (ctx: Ctx, method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  ctx.app.inject({ method, url, headers: H, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
async function created(ctx: Ctx): Promise<string> {
  const r = await send(ctx, 'POST', '/api/applications', { vacancyId: 'fav1', language: 'de' });
  expect(r.statusCode).toBe(202);
  await ctx.applicationJob.whenIdle();
  const state = (await get(ctx, '/api/applications/job')).json() as ApplicationJobState;
  expect(state.state).toBe('done');
  return state.applicationId!;
}

describe('before creating', () => {
  it('GET /new tells language, English warning, short text, existing package and readiness — without Claude', async () => {
    const ctx = await setup();
    ctx.vacancyStore.add(vacancy({ id: 'fav2', status: 'favorite' }), OFFER_EN);
    ctx.vacancyStore.add(vacancy({ id: 'stub', status: 'favorite' }), 'Details beim Partner.');
    expect((await get(ctx, '/api/applications/new?vacancyId=fav1')).json()).toEqual({
      suggestedLanguage: 'de', englishBelowB2: false, shortText: false, existingId: null, readiness: { ready: true, missingSections: [], noStory: false },
    });
    expect((await get(ctx, '/api/applications/new?vacancyId=fav2')).json()).toMatchObject({ suggestedLanguage: 'en' });
    expect((await get(ctx, '/api/applications/new?vacancyId=stub')).json()).toMatchObject({ shortText: true });
    expect((await get(ctx, '/api/applications/new?vacancyId=nope')).statusCode).toBe(404);
    expect(ctx.provider.calls).toHaveLength(0);
  });
  it('English below B2 and missing readiness are reported', async () => {
    const ctx = await setup({ profile: (p) => { p.sections.languages.data.items[1].level = 'A2'; p.stories = []; } });
    expect((await get(ctx, '/api/applications/new?vacancyId=fav1')).json()).toMatchObject({
      englishBelowB2: true, readiness: { ready: false, missingSections: [], noStory: true },
    });
  });
});

describe('create', () => {
  it('POST → 202 running, job done, list and view readable without Claude calls', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    const calls = ctx.provider.calls.length;
    const list = (await get(ctx, '/api/applications')).json();
    expect(list.applications).toEqual([expect.objectContaining({ id, vacancyId: 'fav1', company: 'Muster GmbH', status: 'draft', profileChanged: false, followUpDue: false })]);
    const view = (await get(ctx, `/api/applications/${id}`)).json() as ApplicationView;
    expect(view.application.letter.paragraphs).toEqual(GOOD_LETTER.paragraphs);
    expect(view.profileChanged).toBe(false);
    expect(view.followUpDue).toBe(false);
    expect(ctx.provider.calls.length).toBe(calls);
    expect((await get(ctx, '/api/applications/new?vacancyId=fav1')).json().existingId).toBe(id);
  });
  it('refusals: existing package → 409 PACKAGE_EXISTS with id; bad language → 400; no X-BP-Client → 403', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    const again = await send(ctx, 'POST', '/api/applications', { vacancyId: 'fav1', language: 'de' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({ code: 'PACKAGE_EXISTS', params: { id } });
    expect((await send(ctx, 'POST', '/api/applications', { vacancyId: 'fav1', language: 'fr' })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/applications', payload: { vacancyId: 'fav1', language: 'de' } })).statusCode).toBe(403);
  });
  it('profile not ready → 409 PROFILE_NOT_READY / noStory; no browser → 503 BROWSER_MISSING', async () => {
    const noStory = await setup({ profile: (p) => { p.stories = []; } });
    const r = await send(noStory, 'POST', '/api/applications', { vacancyId: 'fav1', language: 'de' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'PROFILE_NOT_READY', reason: 'noStory' });
    const printer = new FakePrinter();
    printer.isAvailable = false;
    const noBrowser = await setup({ printer });
    expect((await send(noBrowser, 'POST', '/api/applications', { vacancyId: 'fav1', language: 'de' })).json().error.code).toBe('BROWSER_MISSING');
  });
  it('job/cancel stops a running job', async () => {
    const ctx = await setup({ provider: packageClaude({ before: (_t, s) => new Promise((r) => s.addEventListener('abort', r)) }) });
    await send(ctx, 'POST', '/api/applications', { vacancyId: 'fav1', language: 'de' });
    const r = await send(ctx, 'POST', '/api/applications/job/cancel', {});
    expect(r.json().state).toBe('cancelled');
    expect((await get(ctx, '/api/applications')).json().applications).toEqual([]);
  });
});

describe('editing a package', () => {
  it('PATCH letter saves the given fields, recounts pages and makes an approved package a draft', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    ctx.printer.pagesFor = () => 2;
    const r = await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { subject: 'Neuer Betreff', recipient: ['Muster GmbH', 'Frau Anna Müller', 'Hamburg'] });
    const view = r.json() as ApplicationView;
    expect(view.application.letter).toMatchObject({ subject: 'Neuer Betreff', recipient: ['Muster GmbH', 'Frau Anna Müller', 'Hamburg'], pages: 2, paragraphs: GOOD_LETTER.paragraphs });
    expect(view.application.status).toBe('draft');
    expect((await send(ctx, 'PATCH', `/api/applications/${id}/letter`, {})).statusCode).toBe(400);
    expect((await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { paragraphs: [] })).statusCode).toBe(400);
  });
  it('history: approve adds approved, unapprove adds draft, editing an approved package adds draft, editing a draft adds nothing', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    const kinds = () => ctx.applicationStore.require(id).history.map((h) => h.kind);
    expect(kinds()).toEqual([]);
    await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { subject: 'Betreff eins' });
    expect(kinds()).toEqual([]);
    await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    expect(kinds()).toEqual(['approved']);
    await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { subject: 'Betreff zwei' });
    expect(kinds()).toEqual(['approved', 'draft']);
    await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    await send(ctx, 'POST', `/api/applications/${id}/unapprove`, {});
    expect(kinds()).toEqual(['approved', 'draft', 'approved', 'draft']);
  });
  it('approve: one page → approved; two pages → 409 LETTER_TOO_LONG and pages stored; unapprove → draft', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    const ok = (await send(ctx, 'POST', `/api/applications/${id}/approve`, {})).json() as ApplicationView;
    expect(ok.application).toMatchObject({ status: 'approved', approvedAt: expect.any(String) });
    expect((await send(ctx, 'POST', `/api/applications/${id}/unapprove`, {})).json().application.status).toBe('draft');
    ctx.applicationStore.update(id, (p) => { p.letter.pages = 0; });
    ctx.printer.pagesFor = () => 2;
    const long = await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    expect(long.statusCode).toBe(409);
    expect(long.json().error.code).toBe('LETTER_TOO_LONG');
    expect(ctx.applicationStore.require(id).letter.pages).toBe(2);
  });
  it('PATCH cv-profil marks it as edited by hand', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    const view = (await send(ctx, 'PATCH', `/api/applications/${id}/cv-profil`, { profil: 'Mein Text.' })).json() as ApplicationView;
    expect(view.application.cv).toMatchObject({ profil: 'Mein Text.', profilEditedByHand: true });
  });
  it('PATCH cv-headline saves, marks it as edited by hand and returns an approved package to draft; invalid → 400', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    const r = await send(ctx, 'PATCH', `/api/applications/${id}/cv-headline`, { headline: 'Frontend-Entwickler' });
    expect(r.statusCode).toBe(200);
    expect((r.json() as ApplicationView).application).toMatchObject({ status: 'draft', cv: { headline: 'Frontend-Entwickler', headlineEditedByHand: true } });
    expect((await send(ctx, 'PATCH', `/api/applications/${id}/cv-headline`, { headline: '' })).statusCode).toBe(400);
    expect((await send(ctx, 'PATCH', `/api/applications/${id}/cv-headline`, { headline: '   ' })).statusCode).toBe(400);
    expect((await send(ctx, 'PATCH', `/api/applications/${id}/cv-headline`, { headline: 'x'.repeat(81) })).statusCode).toBe(400);
  });
  it('attachments: defaults from "attach always", only known documents may be chosen, deleted ones show as missing', async () => {
    const ctx = await setup({ profile: (p) => { p.documents = [{ id: DOC_ID, ext: '.pdf', originalName: 'zeugnis.pdf', size: 1234, uploadedAt: '2026-09-01T10:00:00.000Z', label: 'Zeugnis', attachAlways: true }]; } });
    fs.writeFileSync(ctx.profileFiles.pathOf({ id: DOC_ID, ext: '.pdf' }), await makePdf(1));
    const id = await created(ctx);
    let view = (await get(ctx, `/api/applications/${id}`)).json() as ApplicationView;
    expect(view.attachments).toEqual([{ id: DOC_ID, label: 'Zeugnis', size: 1234, selected: true, missing: false }]);
    expect((await send(ctx, 'PATCH', `/api/applications/${id}/attachments`, { ids: ['99999999-2222-4333-8444-555555555555'] })).statusCode).toBe(400);
    view = (await send(ctx, 'PATCH', `/api/applications/${id}/attachments`, { ids: [] })).json() as ApplicationView;
    expect(view.attachments[0].selected).toBe(false);
    await send(ctx, 'PATCH', `/api/applications/${id}/attachments`, { ids: [DOC_ID] });
    ctx.profileStore.update((p) => { p.documents = []; });
    view = (await get(ctx, `/api/applications/${id}`)).json() as ApplicationView;
    expect(view.attachments).toEqual([{ id: DOC_ID, label: '', size: 0, selected: true, missing: true }]);
  });
  it('followUpDue is true for a package sent 15 days ago, in the view and in the list', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    const old = new Date(Date.now() - 15 * 86_400_000).toISOString();
    ctx.applicationStore.update(id, (p) => { p.status = 'sent'; p.history = [{ kind: 'approved', at: old }, { kind: 'sent', at: old }]; });
    expect(((await get(ctx, `/api/applications/${id}`)).json() as ApplicationView).followUpDue).toBe(true);
    const list = (await get(ctx, '/api/applications')).json() as { applications: { id: string; followUpDue: boolean }[] };
    expect(list.applications.find((a) => a.id === id)?.followUpDue).toBe(true);
  });
  it('profileChanged turns true when a description changes, and back to false after refresh-cv', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    ctx.profileStore.update((p) => { p.sections.experience.data.items[0].description = 'Anders.'; });
    expect((await get(ctx, `/api/applications/${id}`)).json().profileChanged).toBe(true);
    expect((await send(ctx, 'POST', `/api/applications/${id}/refresh-cv`, { keepProfil: true })).statusCode).toBe(202);
    await ctx.applicationJob.whenIdle();
    expect((await get(ctx, `/api/applications/${id}`)).json().profileChanged).toBe(false);
  });
  it('a frozen package refuses every change and every Claude job (409 packageSent)', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    ctx.applicationStore.update(id, (p) => { p.status = 'sent'; p.history.push({ kind: 'sent', at: '2026-10-05T10:00:00.000Z' }); });
    const calls: ['POST' | 'PATCH', string, unknown][] = [
      ['PATCH', `/api/applications/${id}/letter`, { subject: 'X' }],
      ['PATCH', `/api/applications/${id}/cv-profil`, { profil: 'X' }],
      ['PATCH', `/api/applications/${id}/cv-headline`, { headline: 'X' }],
      ['PATCH', `/api/applications/${id}/attachments`, { ids: [] }],
      ['POST', `/api/applications/${id}/revise`, { instruction: 'kürzer' }],
      ['POST', `/api/applications/${id}/refresh-cv`, { keepProfil: false }],
      ['POST', `/api/applications/${id}/recreate`, { language: 'de' }],
      ['POST', `/api/applications/${id}/approve`, {}],
      ['POST', `/api/applications/${id}/unapprove`, {}],
      ['POST', `/api/applications/${id}/recount`, {}],
    ];
    for (const [m, url, body] of calls) {
      const r = await send(ctx, m, url, body);
      expect(r.statusCode, `${m} ${url}`).toBe(409);
      expect(r.json().error.reason).toBe('packageSent');
    }
    expect(ctx.applicationStore.require(id).status).toBe('sent');
  });
  it('a frozen package never shows "profile changed"', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    ctx.profileStore.update((p) => { p.sections.experience.data.items[0].description = 'Anders.'; });
    expect((await get(ctx, `/api/applications/${id}`)).json().profileChanged).toBe(true);
    ctx.applicationStore.update(id, (p) => { p.status = 'sent'; p.history.push({ kind: 'sent', at: '2026-10-05T10:00:00.000Z' }); });
    expect((await get(ctx, `/api/applications/${id}`)).json().profileChanged).toBe(false);
    const list = (await get(ctx, '/api/applications')).json() as { applications: { id: string; profileChanged: boolean }[] };
    expect(list.applications.find((a) => a.id === id)?.profileChanged).toBe(false);
  });
  it('revise and recreate start jobs; editing while a job works on the package → 409 packageBusy', async () => {
    let release!: () => void;
    let gate: Promise<void> = Promise.resolve();
    const ctx = await setup({ provider: packageClaude({ before: () => gate }) });
    const id = await created(ctx);
    gate = new Promise<void>((r) => { release = r; });
    expect((await send(ctx, 'POST', `/api/applications/${id}/revise`, { instruction: 'Kürzer bitte' })).statusCode).toBe(202);
    const busy = await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { subject: 'x' });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error).toMatchObject({ code: 'CONFLICT', reason: 'packageBusy' });
    expect((await send(ctx, 'DELETE', `/api/applications/${id}`)).statusCode).toBe(409);
    release();
    await ctx.applicationJob.whenIdle();
    expect((await send(ctx, 'POST', `/api/applications/${id}/recreate`, { language: 'en' })).statusCode).toBe(202);
    await ctx.applicationJob.whenIdle();
    expect(ctx.applicationStore.require(id).language).toBe('en');
    expect((await send(ctx, 'POST', `/api/applications/${id}/revise`, { instruction: '' })).statusCode).toBe(400);
  });
  it('DELETE removes the package; unknown or unsafe ids → 404 / 400', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    expect((await send(ctx, 'DELETE', `/api/applications/${id}`)).json()).toEqual({ ok: true });
    expect((await get(ctx, `/api/applications/${id}`)).statusCode).toBe(404);
    expect((await get(ctx, '/api/applications/..%2Fevil')).statusCode).toBe(400);
  });
});

describe('readiness and offline editing', () => {
  it('GET /readiness reports the profile state without Claude', async () => {
    const ctx = await setup({ profile: (p) => { p.stories = []; } });
    expect((await get(ctx, '/api/applications/readiness')).json()).toEqual({ ready: false, missingSections: [], noStory: true });
    expect(ctx.provider.calls).toHaveLength(0);
  });
  it('PATCH letter without a browser still saves the hand edit with pages 0; approve then needs the browser', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    ctx.printer.isAvailable = false;
    const r = await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { subject: 'Handbetreff' });
    expect(r.statusCode).toBe(200);
    expect((r.json() as ApplicationView).application.letter).toMatchObject({ subject: 'Handbetreff', pages: 0 });
    const a = await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    expect(a.statusCode).toBe(503);
    expect(a.json().error.code).toBe('BROWSER_MISSING');
  });
});

describe('approved packages', () => {
  it('Profil and attachment edits turn an approved package back into a draft', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    expect((await send(ctx, 'PATCH', `/api/applications/${id}/cv-profil`, { profil: 'Neu.' })).json().application.status).toBe('draft');
    await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    expect((await send(ctx, 'PATCH', `/api/applications/${id}/attachments`, { ids: [] })).json().application.status).toBe('draft');
  });
});

describe('status routes', () => {
  it('submitted only from approved; it freezes the package', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    expect((await send(ctx, 'POST', `/api/applications/${id}/submitted`, {})).statusCode).toBe(409);
    await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    const r = await send(ctx, 'POST', `/api/applications/${id}/submitted`, {});
    expect(r.statusCode).toBe(200);
    const v = r.json() as ApplicationView;
    expect(v.application).toMatchObject({ status: 'submitted' });
    expect(v.application.history.at(-1)?.kind).toBe('submitted');
    expect(v.application.history.at(-1)?.at).toBe(v.application.updatedAt);
    expect(v.canUndo).toBe(true);
    expect((await send(ctx, 'POST', `/api/applications/${id}/submitted`, {})).statusCode).toBe(409);
    expect((await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { subject: 'X' })).json().error.reason).toBe('packageSent');
  });
  it('every status route refuses while a job works on the package → 409 packageBusy, nothing changes', async () => {
    let release!: () => void;
    let gate: Promise<void> = Promise.resolve();
    const ctx = await setup({ provider: packageClaude({ before: () => gate }) });
    const id = await created(ctx);
    await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    const before = ctx.applicationStore.require(id);
    gate = new Promise<void>((r) => { release = r; });
    expect((await send(ctx, 'POST', `/api/applications/${id}/revise`, { instruction: 'Kürzer bitte' })).statusCode).toBe(202);
    for (const url of [`/api/applications/${id}/submitted`, `/api/applications/${id}/status`, `/api/applications/${id}/status/undo`]) {
      const r = await send(ctx, 'POST', url, { status: 'interview', date: '2026-10-07' });
      expect(r.statusCode, url).toBe(409);
      expect(r.json().error.reason, url).toBe('packageBusy');
    }
    expect(ctx.applicationStore.require(id)).toEqual(before);
    release();
    await ctx.applicationJob.whenIdle();
  });
  it('change status: any outcome in any order, interview twice, note and date kept; refusals', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    const st = (body: unknown) => send(ctx, 'POST', `/api/applications/${id}/status`, body);
    await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    expect((await st({ status: 'interview', date: '2026-10-07' })).statusCode).toBe(409);
    await send(ctx, 'POST', `/api/applications/${id}/submitted`, {});
    expect((await st({ status: 'interview', date: '2026-10-07', note: '  online  ' })).statusCode).toBe(200);
    expect((await st({ status: 'interview', date: '2026-10-14' })).statusCode).toBe(200);
    const last = (await st({ status: 'rejected', date: '2026-10-20', note: '   ' })).json() as ApplicationView;
    expect(last.application.status).toBe('rejected');
    expect(last.application.history.map((h) => h.kind)).toEqual(['approved', 'submitted', 'interview', 'interview', 'rejected']);
    expect(last.application.history[2]).toEqual({ kind: 'interview', at: '2026-10-07T12:00:00.000Z', note: 'online' });
    expect(last.application.history[3]).toEqual({ kind: 'interview', at: '2026-10-14T12:00:00.000Z' });
    expect(last.application.history[4]).toEqual({ kind: 'rejected', at: '2026-10-20T12:00:00.000Z' });
    // updatedAt is the real time of the change, not the chosen date
    expect(last.application.updatedAt).not.toBe('2026-10-20T12:00:00.000Z');
    expect(Math.abs(Date.now() - new Date(last.application.updatedAt).getTime())).toBeLessThan(60_000);
    expect((await st({ status: 'offer', date: '2030-01-01' })).statusCode).toBe(400);
    expect((await st({ status: 'offer', date: '2026-10-07', note: 'x'.repeat(301) })).statusCode).toBe(400);
    expect((await st({ status: 'sent', date: '2026-10-07' })).statusCode).toBe(400);
    expect((await st({ status: 'offer', date: '07.10.2026' })).statusCode).toBe(400);
    expect((await st({ status: 'offer', date: '2026-02-30' })).statusCode).toBe(400);
    expect(ctx.applicationStore.require(id).history).toHaveLength(5);
  });
  it('undo removes the last entry; never a real sent email', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    await send(ctx, 'POST', `/api/applications/${id}/submitted`, {});
    await send(ctx, 'POST', `/api/applications/${id}/status`, { status: 'interview', date: '2026-10-07' });
    const u1 = (await send(ctx, 'POST', `/api/applications/${id}/status/undo`, {})).json() as ApplicationView;
    expect(u1.application.status).toBe('submitted');
    expect(u1.canUndo).toBe(true);
    const u2 = (await send(ctx, 'POST', `/api/applications/${id}/status/undo`, {})).json() as ApplicationView;
    expect(u2.application.status).toBe('approved');
    expect(u2.canUndo).toBe(false);
    expect((await send(ctx, 'POST', `/api/applications/${id}/status/undo`, {})).statusCode).toBe(409);
    expect((await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { subject: 'Wieder editierbar' })).statusCode).toBe(200);

    ctx.applicationStore.update(id, (p) => { p.status = 'sent'; p.history.push({ kind: 'sent', at: '2026-10-05T10:00:00.000Z', messageId: '<m1@x>' }); });
    expect((await get(ctx, `/api/applications/${id}`)).json().canUndo).toBe(false);
    expect((await send(ctx, 'POST', `/api/applications/${id}/status/undo`, {})).statusCode).toBe(409);
    expect(ctx.applicationStore.require(id).status).toBe('sent');
  });
});

describe('final review fixes', () => {
  it('POST recount stores the page count of the current layout and changes nothing else', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    ctx.applicationStore.update(id, (p) => { p.letter.pages = 2; });
    const before = ctx.applicationStore.require(id);
    ctx.printer.pagesFor = () => 1;
    const r = await send(ctx, 'POST', `/api/applications/${id}/recount`, {});
    expect(r.statusCode).toBe(200);
    expect((r.json() as ApplicationView).application.letter.pages).toBe(1);
    const after = ctx.applicationStore.require(id);
    expect({ ...after, letter: { ...after.letter, pages: 2 } }).toEqual(before);
  });
  it('PATCH letter saves the hand edit with pages 0 for ANY print error', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    ctx.printer.print = async () => { throw new Error('browser crashed'); };
    const r = await send(ctx, 'PATCH', `/api/applications/${id}/letter`, { subject: 'Handbetreff' });
    expect(r.statusCode).toBe(200);
    expect((r.json() as ApplicationView).application.letter).toMatchObject({ subject: 'Handbetreff', pages: 0 });
  });
  it('approve always recounts: a stored "1 page" does not hide a longer letter', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    expect(ctx.applicationStore.require(id).letter.pages).toBe(1);
    ctx.printer.pagesFor = () => 2;
    const r = await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    expect(r.json().error.code).toBe('LETTER_TOO_LONG');
    expect(ctx.applicationStore.require(id)).toMatchObject({ status: 'draft', letter: { pages: 2 } });
  });
  it('approve checks again after the print: a job that started meanwhile → 409 packageBusy, nothing approved', async () => {
    const ctx = await setup();
    const id = await created(ctx);
    let started = false;
    ctx.printer.pagesFor = () => {
      if (!started) {
        started = true;
        ctx.applicationJob.start({ kind: 'revise', applicationId: id, instruction: 'kürzer' });
      }
      return 1;
    };
    const r = await send(ctx, 'POST', `/api/applications/${id}/approve`, {});
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('packageBusy');
    await ctx.applicationJob.whenIdle();
    expect(ctx.applicationStore.require(id).status).toBe('draft');
  });
});
