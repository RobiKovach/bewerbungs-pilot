import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { Profile } from '@bp/shared';
import { ApplicationJob, type ApplicationJobDeps } from '../src/applications/job.js';
import { ApplicationStore } from '../src/applications/store.js';
import type { FakeProvider } from '../src/llm/fake.js';
import { LlmQueue } from '../src/llm/queue.js';
import { nullLogger } from '../src/log.js';
import { VacancyStore } from '../src/vacancies/store.js';
import { vacancy } from './helpers/vacancies.js';
import { FakePrinter, GOOD_CV, GOOD_LETTER, packageClaude, readyPackageProfile } from './helpers/applications.js';

const OFFER = 'Wir suchen einen Webentwickler (m/w/d) für unser Team in Hamburg. Sie bauen Online-Shops mit uns.';

function setup(opts: { provider?: FakeProvider; profile?: Profile; printer?: FakePrinter } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp job Дані-'));
  const store = new ApplicationStore(path.join(dir, 'applications'));
  store.load();
  const vacancies = new VacancyStore({ file: path.join(dir, 'vacancies', 'vacancies.json'), textsDir: path.join(dir, 'vacancies', 'texts') });
  vacancies.load();
  const fav = vacancies.add(vacancy({ id: 'fav1', status: 'favorite', company: 'Muster GmbH', locations: ['Hamburg'] }), OFFER);
  const provider = opts.provider ?? packageClaude();
  const printer = opts.printer ?? new FakePrinter();
  let profile = opts.profile ?? readyPackageProfile((p) => { p.sections.wishes.data.remote = 'remote'; });
  let ids = 0;
  const deps: ApplicationJobDeps = {
    store, vacancies, queue: new LlmQueue(provider), printer, logger: nullLogger,
    profile: () => structuredClone(profile), photo: () => null, stateFile: path.join(dir, 'applications', 'job-state.json'),
    newId: () => `app${++ids}`, now: () => new Date('2026-09-29T10:00:00.000Z'),
  };
  const job = new ApplicationJob(deps);
  job.init();
  return { dir, store, vacancies, fav, provider, printer, job, deps, setProfile: (p: Profile) => { profile = p; } };
}

describe('create', () => {
  it('writes a complete package: server-built parts, Claude parts, counted pages, vacancy text copy', async () => {
    const t = setup();
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    expect(t.job.state()).toMatchObject({ state: 'done', kind: 'create', applicationId: 'app1', error: null });
    const p = t.store.require('app1');
    expect(p.letter).toMatchObject({
      recipient: ['Muster GmbH', 'Hamburg'], salutation: 'Sehr geehrte Damen und Herren,', closing: 'Mit freundlichen Grüßen',
      signature: 'Max Mustermann', subject: GOOD_LETTER.subject, paragraphs: GOOD_LETTER.paragraphs, storyIds: ['st1'], pages: 1,
    });
    expect(p.cv).toEqual({ profil: GOOD_CV.profil, profilEditedByHand: false, descriptions: { ed1: GOOD_CV.descriptions[0].text, ex1: GOOD_CV.descriptions[1].text }, headline: 'Webentwickler', headlineEditedByHand: false, skillGroups: GOOD_CV.skillGroups, translations: { Deutsch: 'Deutsch', Deutschland: 'Deutschland', Englisch: 'Englisch' } });
    expect(p.status).toBe('draft');
    expect(t.store.readVacancyText('app1')).toBe(OFFER);
    expect(t.provider.calls).toHaveLength(1);
    expect(t.provider.calls[0].prompt).toContain('Home Office'); // Hamburg ≠ Berlin, wishes remote
    expect(t.printer.printed).toHaveLength(1);
  });

  it('pre-checks throw before anything runs', () => {
    const t = setup();
    expect(() => t.job.start({ kind: 'create', vacancyId: 'nope', language: 'de' })).toThrow(expect.objectContaining({ code: 'VACANCY_NOT_FOUND' }));
    t.vacancies.add(vacancy({ id: 'new1', status: 'new' }), 'x');
    expect(() => t.job.start({ kind: 'create', vacancyId: 'new1', language: 'de' })).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    t.setProfile(readyPackageProfile((p) => { p.stories = []; }));
    expect(() => t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' })).toThrow(expect.objectContaining({ code: 'PROFILE_NOT_READY', reason: 'noStory' }));
    t.setProfile(readyPackageProfile());
    t.printer.isAvailable = false;
    expect(() => t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' })).toThrow(expect.objectContaining({ code: 'BROWSER_MISSING' }));
    expect(t.provider.calls).toHaveLength(0);
    expect(t.job.state().state).toBe('idle');
  });

  it('a second package for the same vacancy → PACKAGE_EXISTS with the id; a second job while one runs → CONFLICT packageBusy', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const t = setup({ provider: packageClaude({ before: () => gate }) });
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    expect(() => t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' })).toThrow(expect.objectContaining({ code: 'CONFLICT', reason: 'packageBusy' }));
    release();
    await t.job.whenIdle();
    expect(() => t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' })).toThrow(expect.objectContaining({ code: 'PACKAGE_EXISTS', params: { id: 'app1' } }));
  });

  it('a never-mention violation → one retry with feedback; fixed → saved', async () => {
    let calls = 0;
    const t = setup({ provider: packageClaude({ create: () => (++calls === 1 ? { ...GOOD_LETTER, ...GOOD_CV, profil: 'Arbeit für Kunde X.' } : { ...GOOD_LETTER, ...GOOD_CV }) }) });
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    expect(t.job.state().state).toBe('done');
    expect(t.provider.calls[1].prompt).toContain('Do not mention "Kunde X" anywhere.');
  });

  it('violations twice → failed PACKAGE_RULES_BROKEN, details without personal text, nothing saved', async () => {
    const t = setup({ provider: packageClaude({ create: { ...GOOD_LETTER, ...GOOD_CV, profil: 'Arbeit für Kunde X.' } }) });
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    expect(t.job.state()).toMatchObject({ state: 'failed', error: { code: 'PACKAGE_RULES_BROKEN' } });
    expect(t.job.state().error!.detailsForLog).not.toContain('Kunde X');
    expect(t.store.list()).toEqual([]);
    expect(t.provider.calls).toHaveLength(2);
  });

  it('a structural error → failed LLM_BAD_OUTPUT at once, no retry', async () => {
    const t = setup({ provider: packageClaude({ create: { ...GOOD_LETTER, ...GOOD_CV, storyIds: ['st2'] } }) });
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    expect(t.job.state()).toMatchObject({ state: 'failed', error: { code: 'LLM_BAD_OUTPUT' } });
    expect(t.provider.calls).toHaveLength(1);
  });

  it('two pages → one shorten call; still two → saved with pages 2', async () => {
    const t = setup();
    t.printer.pagesFor = () => 2;
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    expect(t.provider.calls).toHaveLength(2);
    expect(t.provider.calls[1].prompt).toContain('longer than one A4 page');
    expect(t.store.require('app1').letter.pages).toBe(2);
  });

  it('two pages, then one after shortening → pages 1 and the shortened text', async () => {
    const t = setup({ provider: packageClaude({ revise: { ...GOOD_LETTER, paragraphs: ['Kurz eins.', 'Kurz zwei.', 'Kurz drei.'] } }) });
    let prints = 0;
    t.printer.pagesFor = () => (++prints === 1 ? 2 : 1);
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    expect(t.store.require('app1').letter).toMatchObject({ pages: 1, paragraphs: ['Kurz eins.', 'Kurz zwei.', 'Kurz drei.'] });
  });

  it('cancel → cancelled, nothing saved; a new job can start', async () => {
    const t = setup({ provider: packageClaude({ before: (_task, signal) => new Promise((r) => signal.addEventListener('abort', r)) }) });
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    t.job.cancel();
    await t.job.whenIdle();
    expect(t.job.state().state).toBe('cancelled');
    expect(t.store.list()).toEqual([]);
  });

  it('a printer crash (not BROWSER_MISSING) → failed with a clean error, nothing saved, server alive, a new job can start', async () => {
    const t = setup();
    t.printer.print = async () => { throw new Error('Timed out waiting for page.pdf'); };
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    expect(t.job.state()).toMatchObject({ state: 'failed', error: { code: 'UNKNOWN' } });
    expect(t.store.list()).toEqual([]);
    t.printer.print = async () => (await import('./helpers/applications.js')).makePdf(1);
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    expect(t.job.state().state).toBe('done');
  });

  it('a failed revise leaves the existing package untouched', async () => {
    const t = setup();
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    const before = JSON.stringify(t.store.require('app1'));
    t.printer.print = async () => { throw new Error('boom'); };
    t.job.start({ kind: 'revise', applicationId: 'app1', instruction: 'kürzer' });
    await t.job.whenIdle();
    expect(t.job.state().state).toBe('failed');
    expect(JSON.stringify(t.store.require('app1'))).toBe(before);
  });

  it('after an interruption the package is unchanged and a new job can start', async () => {
    const t = setup();
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    const before = JSON.stringify(t.store.require('app1'));
    fs.writeFileSync(t.deps.stateFile, JSON.stringify({ ...t.job.state(), state: 'running', kind: 'revise', applicationId: 'app1' }));
    const again = new ApplicationJob(t.deps);
    again.init();
    expect(again.state().state).toBe('interrupted');
    expect(JSON.stringify(t.store.require('app1'))).toBe(before);
    again.start({ kind: 'revise', applicationId: 'app1', instruction: 'x' });
    await again.whenIdle();
    expect(again.state().state).toBe('done');
  });

  it('a running state on disk at start-up becomes interrupted', () => {
    const t = setup();
    fs.writeFileSync(t.deps.stateFile, JSON.stringify({ ...t.job.state(), state: 'running', kind: 'create', vacancyId: 'fav1' }));
    const again = new ApplicationJob(t.deps);
    again.init();
    expect(again.state()).toMatchObject({ state: 'interrupted', kind: 'create' });
    expect(JSON.parse(fs.readFileSync(t.deps.stateFile, 'utf8')).state).toBe('interrupted');
  });
});

describe('revise, recreate, refresh CV', () => {
  async function created() {
    const t = setup();
    t.job.start({ kind: 'create', vacancyId: 'fav1', language: 'de' });
    await t.job.whenIdle();
    t.store.update('app1', (p) => { p.status = 'approved'; p.approvedAt = '2026-09-29T11:00:00.000Z'; p.attachments = ['doc1']; });
    return t;
  }

  it('revise: fenced request, new letter parts, server parts kept, back to draft', async () => {
    const t = await created();
    t.store.update('app1', (p) => { p.letter.recipient = ['Muster GmbH', 'Personalabteilung', 'Hamburg']; });
    t.job.start({ kind: 'revise', applicationId: 'app1', instruction: 'Bitte kürzer' });
    await t.job.whenIdle();
    const p = t.store.require('app1');
    expect(t.provider.calls.at(-1)!.prompt).toMatch(/UNTRUSTED_REQUEST_[0-9a-f]{16}>>>\nBitte kürzer/);
    expect(p.letter.recipient).toEqual(['Muster GmbH', 'Personalabteilung', 'Hamburg']);
    expect(p).toMatchObject({ status: 'draft', approvedAt: null });
    expect(t.job.busyWith('app1')).toBe(false);
  });

  it('busyWith is true only while a job works on that package', async () => {
    const t = await created();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    (t.provider as FakeProvider).respond = async () => { await gate; return GOOD_LETTER; };
    t.job.start({ kind: 'revise', applicationId: 'app1', instruction: 'x' });
    expect(t.job.busyWith('app1')).toBe(true);
    expect(t.job.busyWith('other')).toBe(false);
    release();
    await t.job.whenIdle();
    expect(t.job.busyWith('app1')).toBe(false);
  });

  it('recreate: same id, createdAt and attachments; new language; draft; the old letter is replaced', async () => {
    const t = await created();
    const before = t.store.require('app1');
    t.job.start({ kind: 'recreate', applicationId: 'app1', language: 'en' });
    await t.job.whenIdle();
    const p = t.store.require('app1');
    expect(p).toMatchObject({ id: 'app1', createdAt: before.createdAt, attachments: ['doc1'], language: 'en', status: 'draft' });
    expect(p.letter.salutation).toBe('Dear Hiring Team,');
    expect(t.provider.calls.at(-1)!.replyLanguage).toBe('en');
  });

  it('refresh CV without changed descriptions or skills: no Claude, new snapshot and fingerprint, draft', async () => {
    const t = await created();
    const calls = t.provider.calls.length;
    t.setProfile(readyPackageProfile((p) => { p.sections.personal.data.phone = '+49 40 999'; }));
    t.job.start({ kind: 'refreshCv', applicationId: 'app1', keepProfil: true, keepHeadline: false });
    await t.job.whenIdle();
    expect(t.provider.calls.length).toBe(calls);
    const p = t.store.require('app1');
    expect(p.snapshot.personal.phone).toBe('+49 40 999');
    expect(p.status).toBe('draft');
  });

  it('refresh CV with a changed description: Claude refresh; a hand-edited Profil is kept when asked', async () => {
    const t = await created();
    t.store.update('app1', (p) => { p.cv.profil = 'Mein eigener Text.'; p.cv.profilEditedByHand = true; });
    t.setProfile(readyPackageProfile((p) => { p.sections.experience.data.items[0].description = 'Neue Beschreibung.'; }));
    t.job.start({ kind: 'refreshCv', applicationId: 'app1', keepProfil: true, keepHeadline: false });
    await t.job.whenIdle();
    const p = t.store.require('app1');
    expect((t.provider.calls.at(-1)!.schema as { required: string[] }).required).not.toContain('paragraphs');
    expect(p.cv.profil).toBe('Mein eigener Text.');
    expect(p.cv.profilEditedByHand).toBe(true);
    expect(p.snapshot.experience[0].description).toBe('Neue Beschreibung.');
  });

  it('refresh CV with keepProfil false replaces a hand-edited Profil', async () => {
    const t = await created();
    t.store.update('app1', (p) => { p.cv.profil = 'Mein eigener Text.'; p.cv.profilEditedByHand = true; });
    t.setProfile(readyPackageProfile((p) => { p.sections.skills.data.items.push({ id: 'sk6', name: 'React', level: '' }); }));
    (t.provider as FakeProvider).respond = async () => ({ ...GOOD_CV, skillGroups: [{ name: 'Kenntnisse', skillIds: [...GOOD_CV.skillGroups[0].skillIds, 'sk6'] }] });
    t.job.start({ kind: 'refreshCv', applicationId: 'app1', keepProfil: false, keepHeadline: false });
    await t.job.whenIdle();
    expect(t.store.require('app1').cv).toMatchObject({ profil: GOOD_CV.profil, profilEditedByHand: false });
  });

  it('refresh CV with keepHeadline keeps a hand-edited headline, without it Claude\'s headline replaces it', async () => {
    const t = await created();
    t.store.update('app1', (p) => { p.cv.headline = 'Mein Titel'; p.cv.headlineEditedByHand = true; });
    t.setProfile(readyPackageProfile((p) => { p.sections.experience.data.items[0].description = 'Neue Beschreibung.'; }));
    t.job.start({ kind: 'refreshCv', applicationId: 'app1', keepProfil: false, keepHeadline: true });
    await t.job.whenIdle();
    expect(t.store.require('app1').cv).toMatchObject({ headline: 'Mein Titel', headlineEditedByHand: true, translations: { Deutsch: 'Deutsch', Englisch: 'Englisch' } });
    t.setProfile(readyPackageProfile((p) => { p.sections.experience.data.items[0].description = 'Noch neuer.'; }));
    t.job.start({ kind: 'refreshCv', applicationId: 'app1', keepProfil: false, keepHeadline: false });
    await t.job.whenIdle();
    expect(t.store.require('app1').cv).toMatchObject({ headline: 'Webentwickler', headlineEditedByHand: false });
  });

  it('refresh CV on a package from 0.4.0 (migrated v1): Claude is asked even with unchanged inputs; headline, groups and translations arrive', async () => {
    const t = await created();
    const p = t.store.require('app1');
    const { headline: _h, headlineEditedByHand: _e, skillGroups, translations: _t, ...cv } = p.cv;
    void _h; void _e; void _t;
    const { links: _l, ...personal } = p.snapshot.personal;
    void _l;
    const old = { ...p, schemaVersion: 1, cv: { ...cv, skillOrder: skillGroups.flatMap((g) => g.skillIds) }, snapshot: { ...p.snapshot, personal } };
    fs.writeFileSync(path.join(t.dir, 'applications', 'app1', 'package.json'), JSON.stringify(old));
    const store = new ApplicationStore(path.join(t.dir, 'applications'));
    store.load();
    expect(store.require('app1').cv.headline).toBe('');
    const job = new ApplicationJob({ ...t.deps, store });
    job.init();
    const calls = t.provider.calls.length;
    job.start({ kind: 'refreshCv', applicationId: 'app1', keepProfil: false, keepHeadline: false });
    await job.whenIdle();
    expect(job.state().state).toBe('done');
    expect(t.provider.calls.length).toBe(calls + 1);
    expect(store.require('app1').cv).toMatchObject({
      headline: GOOD_CV.headline, skillGroups: GOOD_CV.skillGroups, translations: { Deutsch: 'Deutsch', Englisch: 'Englisch' },
    });
  });

  it('refresh CV on a current package whose inputs did not change still skips Claude', async () => {
    const t = await created();
    const calls = t.provider.calls.length;
    t.job.start({ kind: 'refreshCv', applicationId: 'app1', keepProfil: false, keepHeadline: false });
    await t.job.whenIdle();
    expect(t.provider.calls.length).toBe(calls);
  });

  it('refresh CV with a new country to translate: a bad Claude answer leaves the package unchanged', async () => {
    const t = await created();
    const before = t.store.require('app1');
    t.setProfile(readyPackageProfile((p) => { p.sections.personal.data.country = 'Україна'; }));
    (t.provider as FakeProvider).respond = async () => ({ ...GOOD_CV }); // does not translate "Україна"
    t.job.start({ kind: 'refreshCv', applicationId: 'app1', keepProfil: false, keepHeadline: false });
    await t.job.whenIdle();
    expect(t.job.state()).toMatchObject({ state: 'failed', error: expect.anything() });
    expect(t.store.require('app1')).toEqual(before);
  });
});
