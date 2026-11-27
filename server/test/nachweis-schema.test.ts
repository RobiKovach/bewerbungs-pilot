import { describe, expect, it } from 'vitest';
import type { HistoryEntry, NachweisSetup, Profile } from '@bp/shared';
import { migrate } from '../src/data/migrate.js';
import { PACKAGE_MIGRATIONS, PACKAGE_SCHEMA_VERSION, validatePackage } from '../src/applications/schema.js';
import { canUndo, undoLast } from '../src/applications/status.js';
import { emptyProfile, PROFILE_MIGRATIONS, PROFILE_SCHEMA_VERSION, validateProfile } from '../src/profile/schema.js';
import { pkg } from './helpers/applications.js';

const AT = '2026-11-27T10:00:00.000Z';
const measureSetup = (over: Partial<NachweisSetup> = {}): NachweisSetup => ({
  audience: 'measure', personName: 'Erika Beispiel',
  measure: { provider: 'Bildungsträger GmbH', name: 'Kompakt 2026', entry: '2026-08-17', exit: '', advisor: 'Frau Muster' },
  office: null, blank: { kind: 'standard' }, updatedAt: AT, ...over,
});
const withSetup = (setup: unknown): Profile => ({ ...emptyProfile(), nachweis: setup } as Profile);

describe('profile v5: nachweis setup', () => {
  it('profile v4 file migrates to v5 with nachweis null', () => {
    const v4 = structuredClone(emptyProfile()) as unknown as Record<string, unknown>;
    v4.schemaVersion = 4;
    delete v4.nachweis;
    const out = migrate(v4, PROFILE_SCHEMA_VERSION, PROFILE_MIGRATIONS) as unknown as Profile;
    expect(PROFILE_SCHEMA_VERSION).toBe(5);
    expect(out.schemaVersion).toBe(5);
    expect(out.nachweis).toBeNull();
    expect(validateProfile(out)).toBeNull();
  });
  it('accepts a measure setup and a jobcenter setup', () => {
    expect(validateProfile(withSetup(measureSetup()))).toBeNull();
    expect(validateProfile(withSetup(measureSetup({ audience: 'jobcenter', measure: null, office: { name: 'Jobcenter Dresden', customerNumber: '123A456', advisor: 'Herr X' } })))).toBeNull();
  });
  it('profile rejects office for audience measure and measure for jobcenter', () => {
    expect(validateProfile(withSetup(measureSetup({ office: { name: 'x', customerNumber: '', advisor: '' } })))).not.toBeNull();
    expect(validateProfile(withSetup(measureSetup({ audience: 'jobcenter' })))).not.toBeNull();
  });
  it('rejects own blank for jobcenter', () => {
    const file = { id: '0b6f2c1e-1111-4222-8333-944455556666', ext: '.docx' as const, originalName: 'Bogen.docx', size: 1000, uploadedAt: AT };
    expect(validateProfile(withSetup(measureSetup({ blank: { kind: 'own', file, form: 'bbw-qgz-pp018' } })))).toBeNull();
    expect(validateProfile(withSetup(measureSetup({
      audience: 'agentur', measure: null, office: { name: 'Agentur', customerNumber: '', advisor: '' }, blank: { kind: 'own', file, form: 'bbw-qgz-pp018' },
    })))).not.toBeNull();
  });
});

describe('package v8: nachweis history event', () => {
  it('package v7 migrates to v8 unchanged; history accepts kind nachweis', () => {
    const v7 = { ...pkg({ status: 'submitted', history: [{ kind: 'approved', at: AT }, { kind: 'submitted', at: AT }] }), schemaVersion: 7 };
    const out = migrate(v7 as unknown as Record<string, unknown>, PACKAGE_SCHEMA_VERSION, PACKAGE_MIGRATIONS) as unknown as ReturnType<typeof pkg>;
    expect(PACKAGE_SCHEMA_VERSION).toBe(8);
    expect(out).toEqual({ ...v7, schemaVersion: 8 });
    out.history.push({ kind: 'nachweis', at: AT, note: 'Bewerbungsnachweis_01.11.2026_27.11.2026.docx' });
    expect(validatePackage(out)).toBeNull();
  });
});

describe('undo and the nachweis mark', () => {
  const e = (kind: HistoryEntry['kind'], extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ kind, at: AT, ...extra });
  it('undo skips nachweis: the last status is undone and the mark goes with it', () => {
    const p = pkg({ status: 'submitted', history: [e('approved'), e('submitted'), e('nachweis', { note: 'f.docx' })] });
    expect(canUndo(p)).toBe(true);
    undoLast(p, AT);
    expect(p.status).toBe('approved');
    expect(p.history).toEqual([e('approved')]);
  });
  it('undo of a later status keeps the mark while the package is still submitted', () => {
    const p = pkg({ status: 'interview', history: [e('approved'), e('submitted'), e('nachweis', { note: 'f.docx' }), e('interview')] });
    undoLast(p, AT);
    expect(p.status).toBe('submitted');
    expect(p.history).toEqual([e('approved'), e('submitted'), e('nachweis', { note: 'f.docx' })]);
  });
  it('sent can never be undone even with a later nachweis', () => {
    const p = pkg({ status: 'sent', history: [e('approved'), e('sent', { messageId: '<m@x>' }), e('nachweis')] });
    expect(canUndo(p)).toBe(false);
  });
});
