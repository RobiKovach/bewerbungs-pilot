import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../src/errors.js';
import { assertReady, readiness } from '../src/profile/readiness.js';
import { emptyProfile, SECTION_IDS } from '../src/profile/schema.js';
import { ProfileStore } from '../src/profile/store.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp Профіль-'));

describe('ProfileStore', () => {
  it('starts empty without creating a file', () => {
    const dir = tempDir();
    const store = new ProfileStore(path.join(dir, 'profile.json'));
    expect(store.load()).toEqual(emptyProfile());
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  it('saves atomically and loads back', () => {
    const file = path.join(tempDir(), 'profile.json');
    const store = new ProfileStore(file);
    store.load();
    store.update((p) => { p.neverMention = ['Kunde X']; });
    expect(new ProfileStore(file).load().neverMention).toEqual(['Kunde X']);
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('refuses a change that would make the profile invalid and keeps the old state', () => {
    const file = path.join(tempDir(), 'profile.json');
    const store = new ProfileStore(file);
    store.load();
    store.update((p) => { p.neverMention = ['a']; });
    const err = (() => {
      try {
        store.update((p) => {
          p.sections.experience.data.items.push({ id: 'x', jobTitle: 'Dev', employer: '', city: '', country: '', from: 'soon', to: '', description: '' });
        });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('BAD_REQUEST');
    expect(store.get().sections.experience.data.items).toEqual([]);
    expect(new ProfileStore(file).load().sections.experience.data.items).toEqual([]);
  });
  it('passes on an AppError thrown by the change itself', () => {
    const store = new ProfileStore(path.join(tempDir(), 'profile.json'));
    store.load();
    expect(() => store.update(() => { throw new AppError('NOT_FOUND', 'story'); })).toThrow(/NOT_FOUND/);
  });
  it('reports a failed write as DATA_WRITE_FAILED and keeps memory unchanged', () => {
    const store = new ProfileStore(path.join(tempDir(), 'missing-folder', 'profile.json'));
    store.load();
    expect(() => store.update((p) => { p.neverMention = ['a']; })).toThrow(/DATA_WRITE_FAILED/);
    expect(store.get().neverMention).toEqual([]);
  });
  it('keeps a corrupt file aside and starts empty', () => {
    const dir = tempDir();
    const file = path.join(dir, 'profile.json');
    fs.writeFileSync(file, '{"schemaVersion": 1, "sect');
    const events: string[] = [];
    expect(new ProfileStore(file, (e) => events.push(e)).load()).toEqual(emptyProfile());
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('profile.corrupt-'))).toBe(true);
    expect(events).toEqual(['profile_corrupt']);
  });
  it('keeps a file from a newer app version aside instead of guessing', () => {
    const dir = tempDir();
    const file = path.join(dir, 'profile.json');
    fs.writeFileSync(file, JSON.stringify({ ...emptyProfile(), schemaVersion: 7 }));
    const events: string[] = [];
    expect(new ProfileStore(file, (e) => events.push(e)).load()).toEqual(emptyProfile());
    expect(fs.readdirSync(dir).some((f) => f.startsWith('profile.invalid-'))).toBe(true);
    expect(events).toEqual(['profile_invalid']);
  });
  it('loads a profile saved by version 0.2.0 (schema 1): data kept, no CV proposals, next save writes schema 2', () => {
    const dir = tempDir();
    const file = path.join(dir, 'profile.json');
    const old: Record<string, unknown> = { ...emptyProfile(), schemaVersion: 1, neverMention: ['Kunde X'] };
    delete old.cvProposals;
    fs.writeFileSync(file, JSON.stringify(old));
    const events: string[] = [];
    const store = new ProfileStore(file, (e) => events.push(e));
    const loaded = store.load();
    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.cvProposals).toEqual({});
    expect(loaded.neverMention).toEqual(['Kunde X']);
    expect(events).toEqual([]);
    store.update(() => {});
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ schemaVersion: 2, cvProposals: {} });
  });
});

describe('readiness', () => {
  const allConfirmed = () => {
    const p = emptyProfile();
    for (const id of SECTION_IDS) p.sections[id].confirmedAt = '2026-09-24T10:00:00.000Z';
    return p;
  };
  it('an empty profile misses all six sections and has no stories', () => {
    expect(readiness(emptyProfile())).toEqual({ ready: false, missing: [...SECTION_IDS], warnings: ['noStories'] });
  });
  it('is ready when every section is confirmed; only a confirmed "ok" story removes the warning', () => {
    const p = allConfirmed();
    expect(readiness(p)).toEqual({ ready: true, missing: [], warnings: ['noStories'] });
    p.stories.push({ id: 's1', title: 'T', text: 'X', kind: 'work', disclosure: 'never', confirmed: true });
    expect(readiness(p).warnings).toEqual(['noStories']);
    p.stories.push({ id: 's2', title: 'T', text: 'X', kind: 'work', disclosure: 'ok', confirmed: true });
    expect(readiness(p).warnings).toEqual([]);
  });
  it('assertReady throws PROFILE_NOT_READY with the missing sections', () => {
    expect(() => assertReady(emptyProfile())).toThrow(/PROFILE_NOT_READY: missing: personal/);
    expect(() => assertReady(allConfirmed())).not.toThrow();
  });
});
