import { describe, it, expect } from 'vitest';
import { addStatus, assertEditable, isFrozen, lastChangeAt } from '../src/applications/status.js';
import { AppError } from '../src/errors.js';
import { pkg } from './helpers/applications.js';

describe('package status', () => {
  it('addStatus appends a history entry and sets status and updatedAt', () => {
    const p = pkg({ status: 'approved' });
    addStatus(p, 'sent', '2026-10-05T10:00:00.000Z', { to: 'jobs@muster.example', messageId: '<m1@x>' });
    expect(p.status).toBe('sent');
    expect(p.updatedAt).toBe('2026-10-05T10:00:00.000Z');
    expect(p.history.at(-1)).toEqual({ kind: 'sent', at: '2026-10-05T10:00:00.000Z', to: 'jobs@muster.example', messageId: '<m1@x>' });
  });
  it('draft and approved are editable; every later status is frozen', () => {
    for (const s of ['draft', 'approved'] as const) { expect(isFrozen(pkg({ status: s }))).toBe(false); expect(() => assertEditable(pkg({ status: s }))).not.toThrow(); }
    for (const s of ['sent', 'submitted', 'interview', 'rejected', 'offer', 'withdrawn'] as const) {
      expect(isFrozen(pkg({ status: s }))).toBe(true);
      try { assertEditable(pkg({ status: s })); expect.fail('should throw'); } catch (e) { expect((e as AppError).code).toBe('CONFLICT'); expect((e as AppError).reason).toBe('packageSent'); }
    }
  });
  it('lastChangeAt is the last history entry, else updatedAt', () => {
    expect(lastChangeAt(pkg({ history: [], updatedAt: '2026-10-01T00:00:00.000Z' }))).toBe('2026-10-01T00:00:00.000Z');
    expect(lastChangeAt(pkg({ history: [{ kind: 'approved', at: '2026-10-02T00:00:00.000Z' }] }))).toBe('2026-10-02T00:00:00.000Z');
  });
});
