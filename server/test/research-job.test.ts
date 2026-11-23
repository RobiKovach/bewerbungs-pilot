import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import type { Vacancy } from '@bp/shared';
import { writeJsonAtomic } from '../src/data/atomic.js';
import { AppError } from '../src/errors.js';
import { FakeProvider } from '../src/llm/fake.js';
import { scriptedResponse } from '../src/llm/fake-scripted.js';
import { LlmQueue } from '../src/llm/queue.js';
import { nullLogger } from '../src/log.js';
import { blankResearch, ResearchJob } from '../src/research/job.js';
import { Activity } from '../src/runtime/activity.js';
import { VACANCIES_SCHEMA_VERSION } from '../src/vacancies/schema.js';
import { VacancyStore } from '../src/vacancies/store.js';
import { FakePageReader, vacancy } from './helpers/vacancies.js';

// Every name, address, e-mail and number below is made up.

const PAGE = `Frontend Developer bei Muster Digital GmbH
Tel.: +49 351 1234567
E-Mail: karriere@muster-digital.example`;

function setup(read: (url: string) => string | Promise<string> = () => PAGE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp research-'));
  const paths = { file: path.join(dir, 'vacancies.json'), textsDir: path.join(dir, 'texts') };
  const store = new VacancyStore(paths);
  store.load();
  const provider = new FakeProvider({ ok: true }, (task) => scriptedResponse(task));
  const queue = new LlmQueue(() => provider);
  const reader = new FakePageReader(read);
  const activity = new Activity();
  const fetchNews = vi.fn(async () => []);
  const job = new ResearchJob({ store, reader, fetchNews, queue, logger: nullLogger, activity, language: () => 'de' });
  const add = (id: string, over: Partial<Vacancy> = {}) =>
    store.add(vacancy({ id, source: 'manual', sourceId: null, company: 'Muster Digital GmbH', url: `https://karriere.muster-digital.example/${id}`, ...over }), 'Text');
  return { dir, paths, store, provider, reader, activity, job, add, fetchNews };
}

describe('ResearchJob', () => {
  it('two enqueues run one after another', async () => {
    const gates: Array<() => void> = [];
    let open = 0;
    let most = 0;
    const s = setup(async () => {
      open++; most = Math.max(most, open);
      await new Promise<void>((r) => gates.push(r));
      open--;
      return PAGE;
    });
    s.add('a'); s.add('b');
    s.job.enqueue('a'); s.job.enqueue('b');
    s.job.enqueue('b'); // already waiting: stays where it is
    expect(s.job.busy()).toBe(true);
    await vi.waitFor(() => expect(s.store.require('a').research?.state).toBe('running'));
    expect(s.store.require('b').research?.state).toBe('queued');
    expect(s.activity.active()).toContain('research');
    // Let every page through as soon as it is asked for.
    const drain = setInterval(() => { while (gates.length) gates.shift()?.(); }, 5);
    await s.job.whenIdle();
    clearInterval(drain);
    expect(most).toBe(1);
    expect(s.reader.sessions).toBe(2);
    expect(s.store.require('a').research?.state).toBe('done');
    expect(s.store.require('b').research?.state).toBe('done');
    expect(s.job.busy()).toBe(false);
    expect(s.activity.active()).not.toContain('research');
    // Each card's research got its own company and language; news were asked (full mode).
    expect(s.fetchNews).toHaveBeenCalledTimes(2);
    expect(s.store.require('a').research).toMatchObject({ language: 'de', provider: 'claude' });
  });

  it('hidden or deleted vacancy during research → nothing written', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const s = setup(async () => { await gate; return PAGE; });
    s.add('hide'); s.add('gone'); s.add('keep');
    s.job.enqueue('hide');
    await vi.waitFor(() => expect(s.store.require('hide').research?.state).toBe('running'));
    s.store.update('hide', (x) => { x.status = 'hidden'; });
    release();
    await s.job.whenIdle();
    const hidden = s.store.require('hide');
    expect(hidden.contact).toBeNull();
    expect(hidden.contactAuto).toBeUndefined();
    expect(hidden.research).toMatchObject({ state: 'failed', error: 'LLM_CANCELLED', facts: [], redFlags: [], about: '' });

    // Deleted (here: a restore brought data without the card) while researching: the job just goes on.
    let release2: () => void = () => {};
    const gate2 = new Promise<void>((r) => { release2 = r; });
    const t = setup(async () => { await gate2; return PAGE; });
    t.add('gone'); t.add('keep');
    t.job.enqueue('gone'); t.job.enqueue('keep');
    await vi.waitFor(() => expect(t.store.require('gone').research?.state).toBe('running'));
    writeJsonAtomic(t.paths.file, { schemaVersion: VACANCIES_SCHEMA_VERSION, vacancies: [t.store.require('keep')] });
    t.store.load();
    release2();
    await t.job.whenIdle();
    expect(t.store.get('gone')).toBeUndefined();
    expect(t.store.list().map((v) => v.id)).toEqual(['keep']);
    // The other card's research still ran (the restore made its "queued" a "failed", then the job researched it).
    expect(t.store.require('keep').research?.state).toBe('done');
    // A hidden card is never put in line.
    expect(() => s.job.enqueue('hide')).toThrow(/hidden/);
  });

  it('restart: running/queued becomes failed', async () => {
    const s = setup();
    s.add('r'); s.add('q'); s.add('d');
    s.store.update('r', (x) => { x.research = { ...blankResearch(), state: 'running', startedAt: '2026-11-11T10:00:00.000Z' }; });
    s.store.update('q', (x) => { x.research = blankResearch(); });
    s.store.update('d', (x) => { x.research = { ...blankResearch(), state: 'done', about: 'Software.' }; });
    const again = new VacancyStore(s.paths);
    again.load();
    expect(again.require('r').research).toMatchObject({ state: 'failed', error: 'UNKNOWN', startedAt: '2026-11-11T10:00:00.000Z' });
    expect(again.require('q').research).toMatchObject({ state: 'failed', error: 'UNKNOWN' });
    expect(again.require('d').research).toMatchObject({ state: 'done', about: 'Software.', error: null });
  });

  it('hidden while the pages are read → no AI call at all', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const s = setup(async () => { await gate; return PAGE; });
    s.add('a');
    s.job.enqueue('a');
    await vi.waitFor(() => expect(s.store.require('a').research?.state).toBe('running'));
    s.store.update('a', (x) => { x.status = 'hidden'; });
    release();
    await s.job.whenIdle();
    expect(s.provider.calls).toEqual([]);
    expect(s.store.require('a').research).toMatchObject({ state: 'failed', error: 'LLM_CANCELLED' });
  });

  it('cancel of a waiting card: failed, never started', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const s = setup(async () => { await gate; return PAGE; });
    s.add('a'); s.add('b');
    s.job.enqueue('a'); s.job.enqueue('b');
    s.job.cancel('b');
    expect(s.store.require('b').research).toMatchObject({ state: 'failed', error: 'LLM_CANCELLED' });
    release();
    await s.job.whenIdle();
    expect(s.reader.sessions).toBe(1);
    expect(s.store.require('b').research?.state).toBe('failed');
  });

  it('a failing AI → failed with its code; the next card still runs', async () => {
    const s = setup();
    let first = true;
    s.provider.respond = (task) => {
      if (first && task.id === 'company-research') { first = false; throw new Error('boom'); }
      return scriptedResponse(task);
    };
    s.add('a'); s.add('b');
    s.job.enqueue('a'); s.job.enqueue('b');
    await s.job.whenIdle();
    expect(s.store.require('a').research).toMatchObject({ state: 'failed', error: 'UNKNOWN' });
    expect(s.store.require('b').research?.state).toBe('done');
  });

  it('a final write that fails ends as failed UNKNOWN, not as stopped (final review M4)', async () => {
    const s = setup();
    s.add('a');
    const real = s.store.update.bind(s.store);
    vi.spyOn(s.store, 'update').mockImplementation((id: string, change: (v: Vacancy) => void) => {
      const probe = structuredClone(s.store.require(id));
      change(probe);
      if (probe.research?.state === 'done') throw new AppError('DATA_WRITE_FAILED', 'disk full');
      return real(id, change);
    });
    s.job.enqueue('a');
    await s.job.whenIdle();
    expect(s.store.require('a').research).toMatchObject({ state: 'failed', error: 'UNKNOWN' });
  });
});
