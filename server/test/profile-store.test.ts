import { afterEach, describe, it, expect, vi } from 'vitest';
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
    // As version 0.2.0 wrote it: no cvProposals, no editedAt.
    const old: Record<string, unknown> = { ...emptyProfile(), schemaVersion: 1, neverMention: ['Kunde X'] };
    delete old.cvProposals;
    old.sections = Object.fromEntries(Object.entries(emptyProfile().sections).map(([id, s]) => [id, { data: s.data, aiFields: s.aiFields, confirmedAt: s.confirmedAt }]));
    fs.writeFileSync(file, JSON.stringify(old));
    const events: string[] = [];
    const store = new ProfileStore(file, (e) => events.push(e));
    const loaded = store.load();
    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.cvProposals).toEqual({});
    expect(loaded.sections.personal.editedAt).toBeNull();
    expect(loaded.neverMention).toEqual(['Kunde X']);
    expect(events).toEqual([]);
    store.update(() => {});
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ schemaVersion: 2, cvProposals: {} });
  });

  describe('keeps a copy of a schema-1 file before it is first written as schema 2', () => {
    const writeV1 = (file: string) => {
      const old: Record<string, unknown> = { ...emptyProfile(), schemaVersion: 1, neverMention: ['Kunde X'] };
      delete old.cvProposals;
      old.sections = Object.fromEntries(Object.entries(emptyProfile().sections).map(([id, s]) => [id, { data: s.data, aiFields: s.aiFields, confirmedAt: s.confirmedAt }]));
      const text = JSON.stringify(old);
      fs.writeFileSync(file, text);
      return text;
    };
    const backups = (dir: string) => fs.readdirSync(dir).filter((f) => f.startsWith('profile.v1-')).sort();
    afterEach(() => { vi.restoreAllMocks(); });

    it('copies the file once, before the first write, and never again', () => {
      const dir = tempDir();
      const file = path.join(dir, 'profile.json');
      const original = writeV1(file);
      const store = new ProfileStore(file);
      store.load();
      // Loading alone writes nothing.
      expect(backups(dir)).toEqual([]);
      store.update((p) => { p.neverMention = ['Kunde Y']; });
      const [backup] = backups(dir);
      expect(backups(dir)).toEqual([expect.stringMatching(/^profile\.v1-\d+\.json$/)]);
      expect(fs.readFileSync(path.join(dir, backup), 'utf8')).toBe(original);
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).schemaVersion).toBe(2);
      store.update((p) => { p.neverMention = ['Kunde Z']; });
      // The file is schema 2 now: a restart does not copy it again.
      const restarted = new ProfileStore(file);
      expect(restarted.load().neverMention).toEqual(['Kunde Z']);
      restarted.update(() => {});
      expect(backups(dir)).toEqual([backup]);
    });

    it('never overwrites an existing backup', () => {
      const dir = tempDir();
      const file = path.join(dir, 'profile.json');
      const original = writeV1(file);
      vi.spyOn(Date, 'now').mockReturnValue(1234);
      fs.writeFileSync(path.join(dir, 'profile.v1-1234.json'), 'an older copy');
      const store = new ProfileStore(file);
      store.load();
      store.update(() => {});
      expect(fs.readFileSync(path.join(dir, 'profile.v1-1234.json'), 'utf8')).toBe('an older copy');
      const others = backups(dir).filter((f) => f !== 'profile.v1-1234.json');
      expect(others).toHaveLength(1);
      expect(fs.readFileSync(path.join(dir, others[0]), 'utf8')).toBe(original);
    });

    it('does not write schema 2 when the copy cannot be made', () => {
      const dir = tempDir();
      const file = path.join(dir, 'profile.json');
      const original = writeV1(file);
      const store = new ProfileStore(file);
      store.load();
      vi.spyOn(fs, 'copyFileSync').mockImplementation(() => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });
      expect(() => store.update((p) => { p.neverMention = ['Kunde Y']; })).toThrow(/DATA_WRITE_FAILED/);
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
      expect(store.get().neverMention).toEqual(['Kunde X']);
    });

    it('a profile that starts as schema 2 gets no copy', () => {
      const dir = tempDir();
      const file = path.join(dir, 'profile.json');
      const store = new ProfileStore(file);
      store.load();
      store.update(() => {});
      new ProfileStore(file).load();
      expect(backups(dir)).toEqual([]);
    });
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
