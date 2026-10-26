import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Profile, SearchState } from '@bp/shared';
import { AppError } from '../src/errors.js';
import { LlmQueue } from '../src/llm/queue.js';
import { nullLogger } from '../src/log.js';
import { MAX_NEW_PER_SEARCH, MAX_QUERIES, planQueries, SearchJob, takeFairly } from '../src/vacancies/search-job.js';
import type { SearchQuery } from '../src/vacancies/sources/types.js';
import { VacancyStore } from '../src/vacancies/store.js';
import { fakeSource, hit, profileWithWishes, scoringClaude, vacancy, type FakeSource } from './helpers/vacancies.js';

const WISHES = { jobTitles: ['Webentwickler'], locations: ['Dresden'], radiusKm: 30, employmentTypes: ['fulltime' as const] };

function setup(opts: { source?: FakeSource; provider?: ReturnType<typeof scoringClaude>; profile?: Profile } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp search Дані-'));
  const store = new VacancyStore({ file: path.join(dir, 'vacancies.json'), textsDir: path.join(dir, 'texts') });
  store.load();
  const source = opts.source ?? fakeSource();
  const provider = opts.provider ?? scoringClaude();
  const queue = new LlmQueue(provider);
  const stateFile = path.join(dir, 'search-state.json');
  let profile = opts.profile ?? profileWithWishes(WISHES);
  let ids = 0;
  const job = new SearchJob({
    store, source, queue, logger: nullLogger, profile: () => profile, language: () => 'de', publishedWithinDays: () => 14,
    stateFile, pauseMs: 0, newId: () => `id${++ids}`,
  });
  job.init();
  return { dir, store, source, provider, queue, job, stateFile, setProfile: (p: Profile) => { profile = p; } };
}
const run = async (job: SearchJob) => { job.start(); await job.whenIdle(); return job.state(); };

describe('planQueries', () => {
  const w = (over: object) => ({ ...profileWithWishes({}).sections.wishes.data, ...over });
  it('one query per title × location, work kind with the wished work times', () => {
    const { queries, truncated } = planQueries(w({ jobTitles: ['A', 'B'], locations: ['Dresden', 'Leipzig'], radiusKm: 25, employmentTypes: ['fulltime', 'parttime'] }), 7);
    expect(truncated).toBe(false);
    expect(queries).toHaveLength(4);
    expect(queries[0]).toEqual<SearchQuery>({ jobTitle: 'A', location: 'Dresden', radiusKm: 25, kind: 'work', workTimes: ['fulltime', 'parttime'], publishedWithinDays: 7, includeTemporaryAgencies: true });
  });
  it('remote only → all of Germany, even with cities', () => {
    const { queries } = planQueries(w({ jobTitles: ['A'], locations: ['Dresden'], remote: 'remote' }), 14);
    expect(queries.map((q) => q.location)).toEqual([null]);
  });
  it('no employment types → work without work-time filter; internship and apprenticeship are extra kinds', () => {
    expect(planQueries(w({ jobTitles: ['A'], locations: ['X'] }), 14).queries.map((q) => [q.kind, q.workTimes])).toEqual([['work', []]]);
    const kinds = planQueries(w({ jobTitles: ['A'], locations: ['X'], employmentTypes: ['internship', 'apprenticeship'] }), 14).queries.map((q) => q.kind);
    expect(kinds).toEqual(['apprenticeship', 'internship']);
  });
  it('caps at MAX_QUERIES and says so; skips blank and repeated titles', () => {
    const many = Array.from({ length: 20 }, (_, i) => `T${i}`);
    const r = planQueries(w({ jobTitles: [...many, ' ', 'T0'], locations: many }), 14);
    expect(r.queries).toHaveLength(MAX_QUERIES);
    expect(r.truncated).toBe(true);
  });
  it('passes the Zeitarbeit switch through', () => {
    expect(planQueries(w({ jobTitles: ['A'], locations: ['X'], includeTemporaryAgencies: false }), 14).queries[0].includeTemporaryAgencies).toBe(false);
  });
});

describe('takeFairly', () => {
  const t = (s: string) => s[0]!;
  it('interleaves titles, keeps the order within a title, lets a short title drop out', () => {
    expect(takeFairly(['a1', 'a2', 'a3', 'a4', 'b1', 'c1', 'c2'], t, ['a', 'b', 'c'], 6)).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
  });
  it('one title → the same as taking the first N', () => {
    const xs = ['a1', 'a2', 'a3', 'a4'];
    expect(takeFairly(xs, t, ['a'], 3)).toEqual(xs.slice(0, 3));
  });
  it('fewer offers than the limit → all of them; titles without offers are skipped', () => {
    expect(takeFairly(['b1', 'b2'], t, ['a', 'b'], 50)).toEqual(['b1', 'b2']);
  });
});

describe('SearchJob', () => {
  it('refuses to start without complete wishes', () => {
    const { job } = setup({ profile: profileWithWishes({ jobTitles: ['A'] }) });
    expect(() => job.start()).toThrow(/WISHES_INCOMPLETE/);
    expect(job.state().state).toBe('idle');
  });

  it('a full search: filter, texts, scores, counters, persisted state', async () => {
    const hits = [hit({ sourceId: 'R-1' }), hit({ sourceId: 'R-2', title: 'Werkstudent Web (m/w/d)' }), hit({ sourceId: 'R-3' })];
    const { job, store, provider, stateFile } = setup({ source: fakeSource({ search: () => hits }), provider: scoringClaude({ score: (id) => (id === 'id1' ? 85 : 40) }) });
    const s = await run(job);
    expect(s).toMatchObject({ state: 'done', phase: null, found: 3, filteredOut: { student: 1 }, afterFilter: 2, toScore: 2, scored: 2, moreAvailable: 0, warnings: [], error: null });
    expect(s.finishedAt).not.toBeNull();
    const cards = store.list();
    expect(cards.map((v) => [v.sourceId, v.status, v.scoreState, v.score?.value])).toEqual([['R-1', 'new', 'scored', 85], ['R-3', 'new', 'scored', 40]]);
    expect(store.readText('id1')).toContain('Volltext');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].replyLanguage).toBe('de');
    expect((JSON.parse(fs.readFileSync(stateFile, 'utf8')) as SearchState).state).toBe('done');
  });

  it('a second search finds nothing new ("seen"), and checks old cards for being removed', async () => {
    let online = true;
    const src = fakeSource({ search: () => [hit({ sourceId: 'R-1', company: 'A GmbH', title: 'Webentwickler' })], online: () => online });
    const { job, store } = setup({ source: src });
    await run(job);
    store.add(vacancy({ id: 'old', sourceId: 'R-OLD', foundAt: '2026-09-01T00:00:00.000Z' }), null);
    store.add(vacancy({ id: 'fav', sourceId: 'R-FAV', status: 'favorite' }), null);
    online = false;
    const s = await run(job);
    expect(s).toMatchObject({ found: 1, filteredOut: { seen: 1 }, afterFilter: 0, toScore: 0 });
    expect(src.onlineCalls).toEqual(['R-OLD']);
    expect(store.get('old')!.status).toBe('stale');
    expect(store.get('fav')!.status).toBe('favorite');
    expect(store.list().find((v) => v.sourceId === 'R-1')!.status).toBe('new');
  });

  it('takes at most 50 new offers and says how many are left', async () => {
    const hits = Array.from({ length: 60 }, () => hit());
    const { job, store, provider } = setup({ source: fakeSource({ search: () => hits }) });
    const s = await run(job);
    expect(s).toMatchObject({ afterFilter: 60, toScore: MAX_NEW_PER_SEARCH, moreAvailable: 10, scored: 50 });
    expect(store.list()).toHaveLength(50);
    expect(provider.calls).toHaveLength(5);
  });

  it('several job titles share the 50 new offers round-robin; an offer found by two titles counts once, for the first', async () => {
    const p3 = profileWithWishes({ ...WISHES, jobTitles: ['A', 'B', 'C'] });
    const byTitle: Record<string, ReturnType<typeof hit>[]> = {
      A: Array.from({ length: 60 }, (_, i) => hit({ sourceId: `A-${i}` })),
      B: [hit({ sourceId: 'B-0' }), hit({ sourceId: 'B-1' })],
      C: [hit({ sourceId: 'A-0' }), hit({ sourceId: 'C-0' })],
    };
    const { job, store } = setup({ profile: p3, source: fakeSource({ search: (q) => byTitle[q.jobTitle] ?? [] }) });
    const s = await run(job);
    expect(s).toMatchObject({ found: 63, afterFilter: 63, toScore: MAX_NEW_PER_SEARCH, moreAvailable: 13 });
    const ids = store.list().map((v) => v.sourceId);
    expect(ids).toHaveLength(MAX_NEW_PER_SEARCH);
    expect(ids).toEqual(expect.arrayContaining(['B-0', 'B-1', 'C-0']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith('A-'))).toHaveLength(47);
  });

    it('one failing query → warning; all failing → failed with the code', async () => {
    const p2 = profileWithWishes({ ...WISHES, locations: ['Dresden', 'Leipzig'] });
    const half = setup({ profile: p2, source: fakeSource({ search: (q) => { if (q.location === 'Leipzig') throw new AppError('SOURCE_UNAVAILABLE', 'x'); return [hit()]; } }) });
    expect(await run(half.job)).toMatchObject({ state: 'done', warnings: ['someQueriesFailed'], toScore: 1 });
    const all = setup({ source: fakeSource({ search: () => { throw new AppError('SOURCE_CHANGED', 'HTTP 403'); } }) });
    expect(await run(all.job)).toMatchObject({ state: 'failed', error: { code: 'SOURCE_CHANGED' } });
  });

  it('a failed batch is marked failed and the next batch still runs; an id missing in the answer is failed', async () => {
    const hits = Array.from({ length: 12 }, () => hit());
    let call = 0;
    const provider = scoringClaude({
      score: (id) => (id === 'id12' ? null : 60),
      before: () => { call++; if (call === 1) throw new AppError('LLM_BAD_OUTPUT', 'nonsense'); },
    });
    const { job, store } = setup({ source: fakeSource({ search: () => hits }), provider });
    const s = await run(job);
    expect(s).toMatchObject({ state: 'done', scored: 12 });
    const states = store.list().map((v) => v.scoreState);
    expect(states.slice(0, 10)).toEqual(Array(10).fill('failed'));
    expect(states.slice(10)).toEqual(['scored', 'failed']);
  });

  it('refuses a second start while running; stop → stopped, unscored cards "not scored"', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const provider = scoringClaude({ before: async (_t, signal) => { await Promise.race([gate, new Promise((r) => signal.addEventListener('abort', r))]); } });
    const { job, store } = setup({ source: fakeSource({ search: () => [hit(), hit()] }), provider });
    job.start();
    await expect.poll(() => job.state().phase).toBe('scoring');
    expect(() => job.start()).toThrow(/SEARCH_ALREADY_RUNNING/);
    job.stop();
    await job.whenIdle();
    release();
    expect(job.state().state).toBe('stopped');
    expect(store.list().map((v) => v.scoreState)).toEqual(['notScored', 'notScored']);
  });

  it('never overwrites what the person did meanwhile, and skips an offer they pasted meanwhile', async () => {
    const h1 = hit({ sourceId: 'R-1' });
    const h2 = hit({ sourceId: 'R-2' });
    const ref: { store?: VacancyStore } = {};
    const provider = scoringClaude({ before: () => { ref.store!.update('id1', (v) => { v.status = 'hidden'; v.hiddenAt = '2026-09-28T12:00:00.000Z'; }); } });
    const src = fakeSource({
      search: () => [h1, h2],
      details: (id) => {
        // the person pastes R-2 by hand while the job fetches texts
        if (id === 'R-2') ref.store!.add(vacancy({ id: 'manual', sourceId: 'R-2', addedManually: true }), null);
        return { ...(id === 'R-1' ? h1 : h2), text: 'Text' };
      },
    });
    const { job, store } = setup({ source: src, provider });
    ref.store = store;
    const s = await run(job);
    expect(s.toScore).toBe(1);
    expect(store.get('id1')).toMatchObject({ status: 'hidden', scoreState: 'scored' });
    expect(store.list().filter((v) => v.sourceId === 'R-2').map((v) => v.id)).toEqual(['manual']);
  });

  it('an offer that is gone when its text is fetched is skipped', async () => {
    const { job, store } = setup({ source: fakeSource({ search: () => [hit({ sourceId: 'R-1' }), hit({ sourceId: 'R-2' })], details: (id) => (id === 'R-1' ? null : { ...hit({ sourceId: 'R-2' }), text: 'T' }) }) });
    const s = await run(job);
    expect(s.toScore).toBe(1);
    expect(store.list().map((v) => v.sourceId)).toEqual(['R-2']);
  });

  it('a store failure for one offer is skipped, not fatal: the rest of the search still finishes "done"', async () => {
    const { job, store } = setup({ source: fakeSource({ search: () => [hit({ sourceId: 'R-1' }), hit({ sourceId: 'R-2' })] }) });
    vi.spyOn(store, 'add').mockImplementationOnce(() => { throw new AppError('DATA_WRITE_FAILED', 'disk'); });
    const s = await run(job);
    expect(s).toMatchObject({ state: 'done', toScore: 1, warnings: ['someQueriesFailed'] });
    expect(store.list().map((v) => v.sourceId)).toEqual(['R-2']);
  });

  it('after a restart: a running search is "interrupted", pending cards "not scored", hidden texts cleaned', () => {
    const first = setup();
    first.store.add(vacancy({ id: 'p1', scoreState: 'pending', score: null }), 'T');
    first.store.add(vacancy({ id: 'h1', status: 'hidden', hiddenAt: '2026-09-28T10:00:00.000Z' }), 'T');
    fs.writeFileSync(first.stateFile, JSON.stringify({ ...first.job.state(), state: 'running', phase: 'scoring', startedAt: '2026-09-28T10:00:00.000Z' }));
    const again = new SearchJob({
      store: first.store, source: fakeSource(), queue: first.queue, logger: nullLogger, profile: () => profileWithWishes(WISHES),
      language: () => 'de', publishedWithinDays: () => 14, stateFile: first.stateFile, pauseMs: 0,
    });
    again.init();
    expect(again.state()).toMatchObject({ state: 'interrupted', phase: null });
    expect(again.state().finishedAt).not.toBeNull();
    expect(first.store.get('p1')!.scoreState).toBe('notScored');
    expect(first.store.readText('h1')).toBeNull();
  });

  it('a corrupt state file is treated as idle', () => {
    const { stateFile, store, queue } = setup();
    fs.writeFileSync(stateFile, '{"state": "run');
    const job = new SearchJob({ store, source: fakeSource(), queue, logger: nullLogger, profile: () => profileWithWishes(WISHES), language: () => 'de', publishedWithinDays: () => 14, stateFile, pauseMs: 0 });
    job.init();
    expect(job.state().state).toBe('idle');
  });
});

describe('0.8.0: scores remember the AI; the AI limit stops scoring', () => {
  it.each(['LLM_LIMIT', 'LLM_NOT_INSTALLED', 'LLM_NOT_LOGGED_IN', 'LLM_NOT_CHOSEN'] as const)('%s stops scoring further batches; found cards stay, the rest are notScored', async (code) => {
    const hits = Array.from({ length: 25 }, () => hit());
    let call = 0;
    const provider = scoringClaude({ id: 'chatgpt', before: () => { if (++call === 2) throw new AppError(code, 'will not clear during this search'); } });
    const { job, store } = setup({ source: fakeSource({ search: () => hits }), provider });
    const s = await run(job);
    expect(provider.calls).toHaveLength(2);
    const cards = store.list();
    expect(cards).toHaveLength(25);
    const scored = cards.filter((v) => v.scoreState === 'scored');
    expect(scored).toHaveLength(10);
    expect(scored.every((v) => v.score?.provider === 'chatgpt')).toBe(true);
    expect(cards.filter((v) => v.scoreState === 'notScored')).toHaveLength(15);
    expect(s).toMatchObject({ state: 'failed', phase: null, error: { code } });
  });

  it('no AI helper chosen: scoring stops at the first batch, every card notScored, LLM_NOT_CHOSEN', async () => {
    const hits = Array.from({ length: 25 }, () => hit());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp search Дані-'));
    const store = new VacancyStore({ file: path.join(dir, 'vacancies.json'), textsDir: path.join(dir, 'texts') });
    store.load();
    let resolved = 0;
    const queue = new LlmQueue(() => { resolved++; throw new AppError('LLM_NOT_CHOSEN', 'no AI helper chosen'); });
    let ids = 0;
    const job = new SearchJob({
      store, source: fakeSource({ search: () => hits }), queue, logger: nullLogger, profile: () => profileWithWishes(WISHES), language: () => 'de',
      publishedWithinDays: () => 14, stateFile: path.join(dir, 'search-state.json'), pauseMs: 0, newId: () => `id${++ids}`,
    });
    job.init();
    const s = await run(job);
    expect(resolved).toBe(1);
    expect(store.list()).toHaveLength(25);
    expect(store.list().every((v) => v.scoreState === 'notScored')).toBe(true);
    expect(s).toMatchObject({ state: 'failed', error: { code: 'LLM_NOT_CHOSEN' } });
  });

  it('other AI errors still only fail their own batch', async () => {
    const hits = Array.from({ length: 12 }, () => hit());
    let call = 0;
    const provider = scoringClaude({ before: () => { if (++call === 1) throw new AppError('LLM_TIMEOUT', 'slow'); } });
    const { job, store } = setup({ source: fakeSource({ search: () => hits }), provider });
    expect(await run(job)).toMatchObject({ state: 'done', error: null });
    expect(store.list().filter((v) => v.scoreState === 'scored').every((v) => v.score?.provider === 'claude')).toBe(true);
    expect(store.list().map((v) => v.scoreState)).toEqual([...Array(10).fill('failed'), 'scored', 'scored']);
  });
});
