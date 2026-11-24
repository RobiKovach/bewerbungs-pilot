import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BackupFolderView } from '@bp/shared';
import { ApplicationStore } from '../src/applications/store.js';
import { AutoBackup, AUTO_EVERY_MS } from '../src/backup/auto.js';
import { createBackup } from '../src/backup/create.js';
import { listBackups } from '../src/backup/extract.js';
import { dataIsNewer, dataProblems, dismissDataProblems } from '../src/data/health.js';
import { dataPaths, ensureDataDirs } from '../src/data/paths.js';
import { nullLogger } from '../src/log.js';
import { PROFILE_SCHEMA_VERSION } from '../src/profile/schema.js';
import { ProfileStore } from '../src/profile/store.js';
import { Activity } from '../src/runtime/activity.js';
import { VACANCIES_SCHEMA_VERSION } from '../src/vacancies/schema.js';
import { VacancyStore } from '../src/vacancies/store.js';
import { H, makeApp } from './helpers/app.js';
import { pkg } from './helpers/applications.js';
import { vacancy } from './helpers/vacancies.js';

function data() {
  const p = dataPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'bp health Дані-')));
  ensureDataDirs(p);
  return p;
}
const edit = (file: string, change: (doc: Record<string, unknown>) => void) => {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  change(doc);
  fs.writeFileSync(file, JSON.stringify(doc));
};
const vacancies = (p: ReturnType<typeof data>) => {
  const s = new VacancyStore({ file: p.vacanciesFile, textsDir: p.vacancyTexts });
  s.load();
  return s;
};

describe('data from a newer version', () => {
  it('is recognised for the profile, the vacancies and a package; nothing, this version, the list and broken files are not', () => {
    const p = data();
    expect(dataIsNewer(p)).toBe(false);
    fs.writeFileSync(p.profileFile, JSON.stringify({ schemaVersion: PROFILE_SCHEMA_VERSION }));
    fs.writeFileSync(p.vacanciesFile, '{ broken');
    fs.writeFileSync(path.join(p.applications, 'applications.json'), JSON.stringify({ schemaVersion: 99 }));
    expect(dataIsNewer(p)).toBe(false);
    fs.writeFileSync(p.vacanciesFile, JSON.stringify({ schemaVersion: VACANCIES_SCHEMA_VERSION + 1, vacancies: [] }));
    expect(dataIsNewer(p)).toBe(true);
    const q = data();
    fs.writeFileSync(q.profileFile, JSON.stringify({ schemaVersion: PROFILE_SCHEMA_VERSION + 1 }));
    expect(dataIsNewer(q)).toBe(true);
    const r = data();
    const store = new ApplicationStore(r.applications);
    store.load();
    const one = store.save(pkg(), {});
    edit(path.join(r.applications, one.id, 'package.json'), (d) => { d.schemaVersion = 99; });
    expect(dataIsNewer(r)).toBe(true);
  });

  it('the API refuses everything about the data, but says so and lets the person look at backups and settings', async () => {
    let newer = true;
    const { app } = await makeApp({ dataState: { newer: () => newer } });
    const get = async (url: string) => app.inject({ method: 'GET', url, headers: H });
    for (const url of ['/api/vacancies', '/api/profile', '/api/applications']) {
      const r = await get(url);
      expect([r.statusCode, (r.json() as { error: { code: string } }).error.code]).toEqual([409, 'DATA_NEWER']);
    }
    expect((await app.inject({ method: 'POST', url: '/api/vacancies/search', headers: H })).statusCode).toBe(409);
    for (const url of ['/api/settings', '/api/backups', '/api/health', '/api/updates']) expect((await get(url)).statusCode).toBe(200);
    expect((await get('/api/data-state')).json()).toEqual({ newer: true, problems: [] });
    newer = false;
    expect((await get('/api/vacancies')).statusCode).toBe(200);
  });
});

describe('broken data', () => {
  it('one broken card costs only that card; the file as it was is kept, the person is told until they close the note', () => {
    const p = data();
    const s = vacancies(p);
    for (const id of ['a', 'b', 'c']) s.add(vacancy({ id }), null);
    edit(p.vacanciesFile, (d) => { (d.vacancies as { title: unknown }[])[1]!.title = 5; });
    expect(vacancies(p).list().map((v) => v.id)).toEqual(['a', 'c']);
    const kept = fs.readdirSync(p.vacancies).filter((f) => f.startsWith('vacancies.invalid-'));
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(path.join(p.vacancies, kept[0]!), 'utf8')).toContain('"b"');
    expect(dataProblems(p)).toEqual(['vacancies']);
    // The next start finds a valid file: no second copy.
    expect(vacancies(p).list()).toHaveLength(2);
    expect(fs.readdirSync(p.vacancies).filter((f) => f.startsWith('vacancies.invalid-'))).toHaveLength(1);
    dismissDataProblems(p);
    expect(dataProblems(p)).toEqual([]);
  });

  it('a broken profile section costs only that section', () => {
    const p = data();
    const s = new ProfileStore(p.profileFile);
    s.load();
    s.update((d) => { d.neverMention = ['Kunde X']; d.sections.personal.data.fullName = 'Max Mustermann'; });
    edit(p.profileFile, (d) => { (d.sections as { skills: { data: unknown } }).skills.data = 'oops'; });
    const again = new ProfileStore(p.profileFile).load();
    expect(again.neverMention).toEqual(['Kunde X']);
    expect(again.sections.personal.data.fullName).toBe('Max Mustermann');
    expect(dataProblems(p)).toEqual(['profile']);
  });

  it('a package folder missing from the list is found again', () => {
    const p = data();
    const store = new ApplicationStore(p.applications);
    store.load();
    const one = store.save(pkg(), {});
    edit(path.join(p.applications, 'applications.json'), (d) => { d.applications = []; });
    expect(new ApplicationStore(p.applications).load().map((x) => x.id)).toEqual([one.id]);
  });
});

describe('weekly backup', () => {
  function setup() {
    const p = data();
    const dir = path.join(p.root, '..', `${path.basename(p.root)}-backups`);
    const s = vacancies(p);
    s.add(vacancy({ id: 'a' }), null);
    const state = { now: new Date('2026-11-01T10:00:00Z'), ready: true, available: true };
    const activity = new Activity();
    const auto = new AutoBackup({
      dataRoot: p.root, version: '0.13.4', activity, logger: nullLogger, now: () => state.now, ready: () => state.ready,
      folder: async (): Promise<BackupFolderView> => ({ dir, automatic: true, inOneDrive: false, documentsInOneDrive: false, available: state.available }),
    });
    const list = () => listBackups(dir, { appVersion: '0.13.4' });
    const later = (ms: number) => { state.now = new Date(state.now.getTime() + ms); };
    return { p, dir, state, activity, auto, list, later };
  }

  it('makes one when none is younger than a week, keeps three of its own and never deletes others', async () => {
    const { p, dir, auto, list, later, state } = setup();
    await createBackup(p.root, { dir, kind: 'manual', appVersion: '0.13.4', now: new Date(state.now.getTime() - 2 * AUTO_EVERY_MS) });
    for (let i = 0; i < 5; i++) {
      expect(await auto.run()).toBe(true);
      expect(await auto.run()).toBe(false);
      later(AUTO_EVERY_MS + 1);
    }
    const kinds = (await list()).map((b) => b.kind);
    expect(kinds.filter((k) => k === 'auto')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'manual')).toHaveLength(1);
  });

  it('waits while the data is not ready, the folder is gone, or a restore or update runs', async () => {
    const { auto, list, state, activity } = setup();
    state.ready = false;
    expect(await auto.run()).toBe(false);
    state.ready = true;
    state.available = false;
    expect(await auto.run()).toBe(false);
    state.available = true;
    const end = activity.begin('restore');
    expect(await auto.run()).toBe(false);
    end();
    expect(await list()).toEqual([]);
    expect(await auto.run()).toBe(true);
    expect(activity.active()).toEqual([]);
  });
});
