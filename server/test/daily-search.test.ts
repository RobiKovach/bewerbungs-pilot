import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { nullLogger } from '../src/log.js';
import { DAILY_EVERY_MS, DAILY_MAX_NEW, DailySearch } from '../src/vacancies/daily-search.js';
import { H, makeApp } from './helpers/app.js';
import { fakeSource, hit, scoringClaude } from './helpers/vacancies.js';

async function setup(n = 30) {
  const ctx = await makeApp({ provider: scoringClaude(), source: fakeSource({ search: () => Array.from({ length: n }, (_, i) => hit({ sourceId: `R-${i}` })) }) });
  ctx.profileStore.update((p) => { p.sections.wishes.data = { ...p.sections.wishes.data, jobTitles: ['Webentwickler'], locations: ['Dresden'] }; });
  // Far in the future: the job's own clock must not count as "searched today".
  const s = { now: Date.now() + 10 * DAILY_EVERY_MS, ready: true };
  const stateFile = path.join(ctx.dir, 'daily-search.json');
  const make = () => new DailySearch({ job: ctx.searchJob, activity: ctx.activity, stateFile, ready: () => s.ready, logger: nullLogger, now: () => s.now });
  return { ctx, s, make, stateFile, daily: make() };
}

describe('daily search', () => {
  it('takes 20 offers, once a day, also after a restart; the result is announced until seen', async () => {
    const { ctx, s, make, daily } = await setup();
    expect(daily.run()).toBe(true);
    await ctx.searchJob.whenIdle();
    const state = ctx.searchJob.state();
    expect(state).toMatchObject({ state: 'done', toScore: DAILY_MAX_NEW, moreAvailable: 10, automatic: true });
    expect(make().run()).toBe(false);
    const seen = (startedAt: string | null) => ctx.app.inject({ method: 'POST', url: '/api/vacancies/search/seen', headers: H, payload: { startedAt } });
    expect((await seen('another run')).json().automatic).toBe(true);
    expect((await seen(state.startedAt)).json().automatic).toBe(false);
    s.now += DAILY_EVERY_MS;
    expect(daily.run()).toBe(true);
    await ctx.searchJob.whenIdle();
    ctx.searchJob.start();
    await ctx.searchJob.whenIdle();
    expect(ctx.searchJob.state().automatic).toBe(false);
  });

  it('waits while not ready, searching, restoring or updating; a search by hand counts; a broken or future state file does not block', async () => {
    const { ctx, s, daily, stateFile } = await setup(1);
    s.ready = false;
    expect(daily.run()).toBe(false);
    s.ready = true;
    for (const name of ['restore', 'update']) {
      const end = ctx.activity.begin(name);
      expect(daily.run()).toBe(false);
      end();
    }
    const real = s.now;
    ctx.searchJob.start();
    expect(daily.run()).toBe(false);
    await ctx.searchJob.whenIdle();
    s.now = Date.now() + 1000;
    expect(daily.run()).toBe(false);
    s.now = real;
    fs.writeFileSync(stateFile, '{ broken');
    expect(daily.run()).toBe(true);
    await ctx.searchJob.whenIdle();
    fs.writeFileSync(stateFile, JSON.stringify({ at: real + 100 * DAILY_EVERY_MS }));
    expect(daily.run()).toBe(true);
    await ctx.searchJob.whenIdle();
  });

  it('a start that fails is not tried again within the day', async () => {
    const { ctx, daily } = await setup(1);
    ctx.profileStore.update((p) => { p.sections.wishes.data.jobTitles = []; });
    expect(daily.run()).toBe(false);
    ctx.profileStore.update((p) => { p.sections.wishes.data.jobTitles = ['Webentwickler']; });
    expect(daily.run()).toBe(false);
  });

  it('the setting is off until switched on and leaves the other one alone', async () => {
    const { ctx } = await setup(1);
    expect(ctx.settings.get().vacancies).toEqual({ publishedWithinDays: 14, dailySearch: false });
    const patch = (vacancies: unknown) => ctx.app.inject({ method: 'PATCH', url: '/api/settings', headers: H, payload: { vacancies } });
    expect((await patch({ dailySearch: true })).json().vacancies).toEqual({ publishedWithinDays: 14, dailySearch: true });
    expect((await patch({ publishedWithinDays: 3 })).json().vacancies).toEqual({ publishedWithinDays: 3, dailySearch: true });
    expect((await patch({ dailySearch: 'yes' })).statusCode).toBe(400);
  });
});
