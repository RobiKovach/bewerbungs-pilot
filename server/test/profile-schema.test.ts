import { describe, it, expect } from 'vitest';
import type { Profile, Section } from '@bp/shared';
import { migrate, MigrationError } from '../src/data/migrate.js';
import {
  emptyProfile, isSectionId, PROFILE_MIGRATIONS, PROFILE_SCHEMA_VERSION, validateProfile, validateSectionData,
} from '../src/profile/schema.js';
import {
  applyExtraction, applyHumanEdit, changedPaths, confirmSection, filledPaths, isUntouched, leafPaths, takeExtraction,
} from '../src/profile/sections.js';

const job = (id: string, jobTitle: string) => ({ id, jobTitle, employer: 'Beispiel GmbH', city: 'Berlin', country: '', from: '2018-07', to: '', description: '' });
const T1 = '2026-09-24T10:00:00.000Z';
const T2 = '2026-09-24T11:00:00.000Z';

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
  /** A profile as version 0.2.0 wrote it: no cvProposals, no editedAt. */
  const v1Of = (p: Profile): Record<string, unknown> => {
    const v1: Record<string, unknown> = { ...structuredClone(p), schemaVersion: 1 };
    delete v1.cvProposals;
    v1.sections = Object.fromEntries(Object.entries(p.sections).map(([id, s]) => [id, { data: s.data, aiFields: s.aiFields, confirmedAt: s.confirmedAt }]));
    return v1;
  };
  it('profile version 1 files get an empty proposal list and no edit record', () => {
    const out = migrate(v1Of(emptyProfile()), PROFILE_SCHEMA_VERSION, PROFILE_MIGRATIONS);
    expect(out).toEqual(emptyProfile());
    expect(validateProfile(out)).toBeNull();
  });
  it('a version 1 section with fields the person filled or changed counts as edited', () => {
    const p = emptyProfile();
    p.sections.experience.data.items = [job('a', 'Dev')];
    p.sections.experience.aiFields = filledPaths(p.sections.experience.data); // exactly as the CV filled it
    p.sections.personal.data.fullName = 'Max Mustermann'; // typed by the person: no AI mark
    const out = migrate(v1Of(p), PROFILE_SCHEMA_VERSION, PROFILE_MIGRATIONS) as unknown as Profile;
    expect(validateProfile(out)).toBeNull();
    expect(out.sections.experience.editedAt).toBeNull();
    expect(out.sections.personal.editedAt).toEqual(expect.any(String));
    expect(isUntouched(out.sections.personal)).toBe(false);
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
  it('a human edit removes AI marks only from changed fields, keeps the confirmation and records the edit', () => {
    const s: Section<{ items: ReturnType<typeof job>[] }> = {
      data: { items: [job('a', 'Dev')] }, aiFields: ['items.a.jobTitle', 'items.a.employer'], confirmedAt: '2026-09-24T10:00:00.000Z',
      editedAt: null,
    };
    const next = applyHumanEdit(s, { items: [job('a', 'Senior Dev')] }, T2);
    expect(next.aiFields).toEqual(['items.a.employer']);
    expect(next.confirmedAt).toBe('2026-09-24T10:00:00.000Z');
    expect(next.editedAt).toBe(T2);
    expect(applyHumanEdit(s, { items: [] }, T2).aiFields).toEqual([]);
  });
  it('saving without a change records no edit and keeps an earlier one', () => {
    const data = { items: [job('a', 'Dev')] };
    expect(applyHumanEdit({ data, aiFields: filledPaths(data), confirmedAt: null, editedAt: null }, data, T2).editedAt).toBeNull();
    expect(applyHumanEdit({ data, aiFields: [], confirmedAt: null, editedAt: T1 }, data, T2).editedAt).toBe(T1);
  });
  it('confirming clears all AI marks and keeps the edit record', () => {
    const s = { data: { items: [] }, aiFields: ['x'], confirmedAt: null, editedAt: T1 };
    expect(confirmSection(s, T2)).toEqual({ data: { items: [] }, aiFields: [], confirmedAt: T2, editedAt: T1 });
  });
  it('a section is untouched only while the person has neither confirmed nor changed it since the CV filled it', () => {
    const data = { items: [job('a', 'Dev'), job('b', 'Lead')] };
    const fresh = { data, aiFields: filledPaths(data), confirmedAt: null, editedAt: null };
    expect(isUntouched(fresh)).toBe(true);
    expect(isUntouched({ data: { items: [] }, aiFields: [], confirmedAt: null, editedAt: null })).toBe(true);
    expect(isUntouched({ ...fresh, confirmedAt: T1 })).toBe(false);
    expect(isUntouched(applyHumanEdit(fresh, { items: [job('a', 'Senior Dev'), job('b', 'Lead')] }, T2))).toBe(false);
    // Deleting an entry or clearing a field is work too, although every remaining filled field is still AI-marked.
    const deleted = applyHumanEdit(fresh, { items: [job('a', 'Dev')] }, T2);
    expect(filledPaths(deleted.data).every((p) => deleted.aiFields.includes(p))).toBe(true);
    expect(isUntouched(deleted)).toBe(false);
    expect(isUntouched(applyHumanEdit(fresh, { items: [{ ...job('a', 'Dev'), city: '' }, job('b', 'Lead')] }, T2))).toBe(false);
  });
  it('an extraction with the same content (new ids) changes nothing and drops a stale proposal', () => {
    const s = { data: { items: [job('a', 'Dev')] }, aiFields: [], confirmedAt: T1, editedAt: null };
    expect(applyExtraction(s, { items: [job('zzz', 'Dev')] })).toEqual({ section: s, outcome: 'same', proposal: null });
  });
  it('different content replaces an untouched section, marked, unconfirmed and not edited', () => {
    const old = { items: [job('a', 'Dev')] };
    const s = { data: old, aiFields: filledPaths(old), confirmedAt: null, editedAt: null };
    const next = { items: [job('n1', 'Lead')] };
    const r = applyExtraction(s, next);
    expect(r).toEqual({
      section: { data: next, aiFields: filledPaths(next), confirmedAt: null, editedAt: null }, outcome: 'replaced', proposal: null,
    });
    expect(takeExtraction(next)).toEqual(r.section);
  });
  it('different content leaves a worked-on section exactly as it is and becomes a proposal', () => {
    const next = { items: [job('n1', 'Lead')] };
    const confirmed = { data: { items: [job('a', 'Dev')] }, aiFields: [], confirmedAt: T1, editedAt: null };
    expect(applyExtraction(confirmed, next)).toEqual({ section: confirmed, outcome: 'proposed', proposal: next });
    const edited = { data: { items: [job('a', 'Dev')] }, aiFields: ['items.a.employer'], confirmedAt: null, editedAt: T1 };
    expect(applyExtraction(edited, next)).toEqual({ section: edited, outcome: 'proposed', proposal: next });
  });
});
