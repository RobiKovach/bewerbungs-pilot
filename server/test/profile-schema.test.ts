import { describe, it, expect } from 'vitest';
import type { Section } from '@bp/shared';
import { migrate, MigrationError } from '../src/data/migrate.js';
import { emptyProfile, isSectionId, validateProfile, validateSectionData } from '../src/profile/schema.js';
import { applyExtraction, applyHumanEdit, changedPaths, confirmSection, filledPaths, leafPaths } from '../src/profile/sections.js';

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
  it('an extraction with the same content (new ids) changes nothing; different content resets the section', () => {
    const s = { data: { items: [job('a', 'Dev')] }, aiFields: [], confirmedAt: '2026-09-24T10:00:00.000Z' };
    expect(applyExtraction(s, { items: [job('zzz', 'Dev')] })).toEqual({ section: s, changed: false });
    const r = applyExtraction(s, { items: [job('n1', 'Lead')] });
    expect(r.changed).toBe(true);
    expect(r.section).toEqual({ data: { items: [job('n1', 'Lead')] }, aiFields: filledPaths({ items: [job('n1', 'Lead')] }), confirmedAt: null });
  });
});
