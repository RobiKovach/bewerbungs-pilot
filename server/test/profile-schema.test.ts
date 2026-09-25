import { describe, it, expect } from 'vitest';
import type { Section } from '@bp/shared';
import { migrate, MigrationError } from '../src/data/migrate.js';
import {
  emptyProfile, isSectionId, PROFILE_MIGRATIONS, PROFILE_SCHEMA_VERSION, validateProfile, validateSectionData,
} from '../src/profile/schema.js';
import {
  applyExtraction, applyHumanEdit, changedPaths, confirmSection, filledPaths, isUntouched, leafPaths, takeExtraction,
} from '../src/profile/sections.js';

const job = (id: string, jobTitle: string) => ({ id, jobTitle, employer: 'Beispiel GmbH', city: 'Berlin', country: '', from: '2018-07', to: '', description: '' });

describe('profile schema', () => {
  it('accepts the empty profile', () => {
    expect(validateProfile(emptyProfile())).toBeNull();
  });
  it('rejects bad dates, unknown fields and duplicate entry ids', () => {
    expect(validateSectionData('experience', { items: [{ ...job('a', 'Dev'), from: '07/2018' }] })).toMatch(/pattern/);
    expect(validateSectionData('personal', { ...emptyProfile().sections.personal.data, hobby: 'x' })).toMatch(/additional/);
    expect(validateSectionData('experience', { items: [job('a', 'Dev'), job('a', 'Dev 2')] })).toBe('duplicate entry ids');
  });
  it('knows its section ids', () => {
    expect(isSectionId('wishes')).toBe(true);
    expect(isSectionId('__proto__')).toBe(false);
  });
});

describe('migrate', () => {
  it('profile version 1 files get an empty proposal list', () => {
    const v1: Record<string, unknown> = { ...emptyProfile(), schemaVersion: 1 };
    delete v1.cvProposals;
    const out = migrate(v1, PROFILE_SCHEMA_VERSION, PROFILE_MIGRATIONS);
    expect(out).toEqual(emptyProfile());
    expect(validateProfile(out)).toBeNull();
  });
  it('checks proposals with the same rules as the section itself', () => {
    const p = emptyProfile();
    p.cvProposals = { experience: { items: [job('a', 'Dev')] } };
    expect(validateProfile(p)).toBeNull();
    p.cvProposals = { experience: { items: [{ ...job('a', 'Dev'), from: '07/2018' }] } };
    expect(validateProfile(p)).toMatch(/pattern/);
    p.cvProposals = { experience: { items: [job('a', 'Dev'), job('a', 'Dev')] } };
    expect(validateProfile(p)).toMatch(/duplicate entry ids/);
    expect(validateProfile({ ...emptyProfile(), cvProposals: { wishes: emptyProfile().sections.wishes.data } })).toMatch(/additional/);
  });
  it('passes the current version through', () => {
    expect(migrate({ schemaVersion: 1, a: 1 }, 1, {})).toEqual({ schemaVersion: 1, a: 1 });
  });
  it('runs every step up to the current version', () => {
    const out = migrate({ schemaVersion: 1, name: 'x' }, 3, {
      1: (d) => ({ ...d, added: true }),
      2: (d) => ({ ...d, name: String(d.name).toUpperCase() }),
    });
    expect(out).toEqual({ schemaVersion: 3, name: 'X', added: true });
  });
  it('refuses a newer file, a missing version and a missing step', () => {
    expect(() => migrate({ schemaVersion: 2 }, 1, {})).toThrow(MigrationError);
    expect(() => migrate({ nothing: true }, 1, {})).toThrow(MigrationError);
    expect(() => migrate({ schemaVersion: 1 }, 2, {})).toThrow(/no migration from version 1/);
  });
});

describe('section rules', () => {
  it('addresses list entries by id, so reordering changes nothing', () => {
    const a = { items: [job('a', 'Dev'), job('b', 'Lead')] };
    const b = { items: [job('b', 'Lead'), job('a', 'Dev')] };
    expect(leafPaths(a).get('items.a.jobTitle')).toBe('"Dev"');
    expect(changedPaths(a, b).size).toBe(0);
    expect([...changedPaths(a, { items: [job('a', 'Senior Dev'), job('b', 'Lead')] })]).toEqual(['items.a.jobTitle']);
  });
  it('lists only filled fields', () => {
    expect(filledPaths({ items: [job('a', 'Dev')] })).toEqual(['items.a.jobTitle', 'items.a.employer', 'items.a.city', 'items.a.from']);
  });
  it('a human edit removes AI marks only from changed fields and keeps the confirmation', () => {
    const s: Section<{ items: ReturnType<typeof job>[] }> = {
      data: { items: [job('a', 'Dev')] }, aiFields: ['items.a.jobTitle', 'items.a.employer'], confirmedAt: '2026-09-24T10:00:00.000Z',
    };
    const next = applyHumanEdit(s, { items: [job('a', 'Senior Dev')] });
    expect(next.aiFields).toEqual(['items.a.employer']);
    expect(next.confirmedAt).toBe('2026-09-24T10:00:00.000Z');
    expect(applyHumanEdit(s, { items: [] }).aiFields).toEqual([]);
  });
  it('confirming clears all AI marks', () => {
    const s = { data: { items: [] }, aiFields: ['x'], confirmedAt: null };
    expect(confirmSection(s, '2026-09-24T11:00:00.000Z')).toEqual({ data: { items: [] }, aiFields: [], confirmedAt: '2026-09-24T11:00:00.000Z' });
  });
  it('a section is untouched only while unconfirmed and every filled field still carries its AI mark', () => {
    const data = { items: [job('a', 'Dev')] };
    const fresh = { data, aiFields: filledPaths(data), confirmedAt: null };
    expect(isUntouched(fresh)).toBe(true);
    expect(isUntouched({ data: { items: [] }, aiFields: [], confirmedAt: null })).toBe(true);
    expect(isUntouched({ ...fresh, confirmedAt: '2026-09-24T10:00:00.000Z' })).toBe(false);
    expect(isUntouched(applyHumanEdit(fresh, { items: [job('a', 'Senior Dev')] }))).toBe(false);
  });
  it('an extraction with the same content (new ids) changes nothing and drops a stale proposal', () => {
    const s = { data: { items: [job('a', 'Dev')] }, aiFields: [], confirmedAt: '2026-09-24T10:00:00.000Z' };
    expect(applyExtraction(s, { items: [job('zzz', 'Dev')] })).toEqual({ section: s, outcome: 'same', proposal: null });
  });
  it('different content replaces an untouched section, marked and unconfirmed', () => {
    const old = { items: [job('a', 'Dev')] };
    const s = { data: old, aiFields: filledPaths(old), confirmedAt: null };
    const next = { items: [job('n1', 'Lead')] };
    const r = applyExtraction(s, next);
    expect(r).toEqual({ section: { data: next, aiFields: filledPaths(next), confirmedAt: null }, outcome: 'replaced', proposal: null });
    expect(takeExtraction(next)).toEqual(r.section);
  });
  it('different content leaves a worked-on section exactly as it is and becomes a proposal', () => {
    const next = { items: [job('n1', 'Lead')] };
    const confirmed = { data: { items: [job('a', 'Dev')] }, aiFields: [], confirmedAt: '2026-09-24T10:00:00.000Z' };
    expect(applyExtraction(confirmed, next)).toEqual({ section: confirmed, outcome: 'proposed', proposal: next });
    const edited = { data: { items: [job('a', 'Dev')] }, aiFields: ['items.a.employer'], confirmedAt: null };
    expect(applyExtraction(edited, next)).toEqual({ section: edited, outcome: 'proposed', proposal: next });
  });
});
