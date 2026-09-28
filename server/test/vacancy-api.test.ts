import { describe, it, expect } from 'vitest';
import type { Vacancy } from '@bp/shared';
import { H, makeApp } from './helpers/app.js';
import { details, fakeSource, hit, scoringClaude, vacancy } from './helpers/vacancies.js';

type Ctx = Awaited<ReturnType<typeof makeApp>>;
const withWishes = (ctx: Ctx) => ctx.profileStore.update((p) => {
  p.sections.wishes.data = { ...p.sections.wishes.data, jobTitles: ['Webentwickler'], locations: ['Dresden'] };
});
const post = (ctx: Ctx, url: string, payload: Record<string, unknown> = {}) => ctx.app.inject({ method: 'POST', url, headers: H, payload });
const get = (ctx: Ctx, url: string) => ctx.app.inject({ method: 'GET', url });

describe('search endpoints', () => {
  it('start → 202, state readable without side effects, cards appear, list shows them', async () => {
    const ctx = await makeApp({ provider: scoringClaude(), source: fakeSource({ search: () => [hit({ sourceId: 'R-1' })] }) });
    withWishes(ctx);
    const started = await post(ctx, '/api/vacancies/search');
    expect(started.statusCode).toBe(202);
    expect(started.json().state).toBe('running');
    await ctx.searchJob.whenIdle();
    const calls = ctx.provider.calls.length;
    const state = await get(ctx, '/api/vacancies/search');
    expect(state.json()).toMatchObject({ state: 'done', toScore: 1, scored: 1 });
    expect(ctx.provider.calls.length).toBe(calls);
    const list = (await get(ctx, '/api/vacancies')).json() as { vacancies: Vacancy[] };
    expect(list.vacancies.map((v) => [v.sourceId, v.scoreState])).toEqual([['R-1', 'scored']]);
  });

  it('incomplete wishes → 409 WISHES_INCOMPLETE; a second start → 409 SEARCH_ALREADY_RUNNING; stop → stopped', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const ctx = await makeApp({
      provider: scoringClaude({ before: async (_t, s) => { await Promise.race([gate, new Promise((r) => s.addEventListener('abort', r))]); } }),
      source: fakeSource({ search: () => [hit()] }),
    });
    const early = await post(ctx, '/api/vacancies/search');
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('WISHES_INCOMPLETE');
    withWishes(ctx);
    await post(ctx, '/api/vacancies/search');
    await expect.poll(() => ctx.searchJob.state().phase).toBe('scoring');
    const again = await post(ctx, '/api/vacancies/search');
    expect(again.json().error.code).toBe('SEARCH_ALREADY_RUNNING');
    expect((await post(ctx, '/api/vacancies/search/stop')).statusCode).toBe(200);
    await ctx.searchJob.whenIdle();
    release();
    expect((await get(ctx, '/api/vacancies/search')).json().state).toBe('stopped');
  });
});

describe('card endpoints', () => {
  it('text: stored text, "" when none, 404 for an unknown card', async () => {
    const ctx = await makeApp();
    ctx.vacancyStore.add(vacancy({ id: 'a' }), 'Volltext');
    ctx.vacancyStore.add(vacancy({ id: 'b' }), null);
    expect((await get(ctx, '/api/vacancies/a/text')).json()).toEqual({ text: 'Volltext' });
    expect((await get(ctx, '/api/vacancies/b/text')).json()).toEqual({ text: '' });
    const missing = await get(ctx, '/api/vacancies/zzz/text');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('VACANCY_NOT_FOUND');
  });

  it('status: allowed transitions only, hiddenAt kept in step', async () => {
    const ctx = await makeApp();
    ctx.vacancyStore.add(vacancy({ id: 'a' }), 'T');
    const fav = await post(ctx, '/api/vacancies/a/status', { status: 'favorite' });
    expect(fav.json().vacancy.status).toBe('favorite');
    const bad = await post(ctx, '/api/vacancies/a/status', { status: 'hidden' });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.code).toBe('CONFLICT');
    await post(ctx, '/api/vacancies/a/status', { status: 'new' });
    const hidden = (await post(ctx, '/api/vacancies/a/status', { status: 'hidden' })).json().vacancy as Vacancy;
    expect(hidden.hiddenAt).not.toBeNull();
    const back = (await post(ctx, '/api/vacancies/a/status', { status: 'new' })).json().vacancy as Vacancy;
    expect(back).toMatchObject({ status: 'new', hiddenAt: null, scoreState: 'scored' });
    expect((await post(ctx, '/api/vacancies/a/status', { status: 'stale' })).statusCode).toBe(400);
  });

  it('bringing back a compacted card reloads its text; if the offer is gone it becomes stale', async () => {
    const h = hit({ sourceId: 'R-1' });
    let gone = false;
    const ctx = await makeApp({ source: fakeSource({ details: () => (gone ? null : details(h, 'Neuer Text')) }) });
    ctx.vacancyStore.add(vacancy({ id: 'a', sourceId: 'R-1', status: 'hidden', hiddenAt: '2026-09-28T10:00:00.000Z' }), 'Alt');
    ctx.vacancyStore.add(vacancy({ id: 'b', sourceId: 'R-2', status: 'hidden', hiddenAt: '2026-09-28T10:00:00.000Z' }), 'Alt');
    ctx.vacancyStore.compactHidden();
    const back = (await post(ctx, '/api/vacancies/a/status', { status: 'new' })).json().vacancy as Vacancy;
    expect(back).toMatchObject({ status: 'new', title: h.title, hasText: true, score: null, scoreState: 'notScored' });
    expect(ctx.vacancyStore.readText('a')).toBe('Neuer Text');
    gone = true;
    const stale = (await post(ctx, '/api/vacancies/b/status', { status: 'new' })).json().vacancy as Vacancy;
    expect(stale.status).toBe('stale');
  });

  it('text refresh: only for Arbeitsagentur cards', async () => {
    const h = hit({ sourceId: 'R-1' });
    const ctx = await makeApp({ source: fakeSource({ details: () => details(h, 'Frisch') }) });
    ctx.vacancyStore.add(vacancy({ id: 'a', sourceId: 'R-1' }), null);
    ctx.vacancyStore.add(vacancy({ id: 'm', source: 'manual', sourceId: null, addedManually: true }), 'Eigen');
    expect((await post(ctx, '/api/vacancies/a/text/refresh')).json().vacancy.hasText).toBe(true);
    expect(ctx.vacancyStore.readText('a')).toBe('Frisch');
    expect((await post(ctx, '/api/vacancies/m/text/refresh')).statusCode).toBe(409);
  });

  it('score again: one card, one Claude call; refused while pending or without text', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ score: () => 91 }) });
    ctx.vacancyStore.add(vacancy({ id: 'a' }), 'Text');
    ctx.vacancyStore.add(vacancy({ id: 'p', scoreState: 'pending', score: null }), 'Text');
    ctx.vacancyStore.add(vacancy({ id: 'n' }), null);
    const res = await post(ctx, '/api/vacancies/a/score');
    expect(res.json().vacancy).toMatchObject({ scoreState: 'scored', score: { value: 91 } });
    expect(ctx.provider.calls).toHaveLength(1);
    expect((await post(ctx, '/api/vacancies/p/score')).statusCode).toBe(409);
    expect((await post(ctx, '/api/vacancies/n/score')).statusCode).toBe(409);
  });

  it('score again: Claude leaves the card out → failed', async () => {
    const ctx = await makeApp({ provider: scoringClaude({ score: () => null }) });
    ctx.vacancyStore.add(vacancy({ id: 'a' }), 'Text');
    expect((await post(ctx, '/api/vacancies/a/score')).json().vacancy.scoreState).toBe('failed');
  });

  it('edit: only manual cards, only http(s) links', async () => {
    const ctx = await makeApp();
    ctx.vacancyStore.add(vacancy({ id: 'm', source: 'manual', sourceId: null, addedManually: true }), 'T');
    ctx.vacancyStore.add(vacancy({ id: 'a' }), 'T');
    const body = { title: 'Frontend Developer', company: 'Muster GmbH', locations: ['Dresden'], url: 'https://muster.example/job', contact: { email: 'hr@muster.example', salutation: 'Frau', name: 'Erika Beispiel' } };
    const ok = await ctx.app.inject({ method: 'PATCH', url: '/api/vacancies/m', headers: H, payload: body });
    expect(ok.json().vacancy).toMatchObject(body);
    expect((await ctx.app.inject({ method: 'PATCH', url: '/api/vacancies/a', headers: H, payload: body })).statusCode).toBe(409);
    const js = await ctx.app.inject({ method: 'PATCH', url: '/api/vacancies/m', headers: H, payload: { ...body, url: 'javascript:alert(1)' } });
    expect(js.statusCode).toBe(400);
  });
});
