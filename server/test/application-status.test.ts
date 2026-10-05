import { describe, it, expect } from 'vitest';
import type { HistoryEntry } from '@bp/shared';
import { addStatus, assertEditable, canUndo, dateToIso, isFrozen, undoLast } from '../src/applications/status.js';
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
});

describe('undo and dates', () => {
  const entry = (kind: HistoryEntry['kind'], extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ kind, at: '2026-10-05T10:00:00.000Z', ...extra });
  it('canUndo: frozen with a last entry that is not a real sent email', () => {
    expect(canUndo(pkg({ status: 'approved', history: [entry('approved')] }))).toBe(false);
    expect(canUndo(pkg({ status: 'submitted', history: [entry('approved'), entry('submitted')] }))).toBe(true);
    expect(canUndo(pkg({ status: 'sent', history: [entry('approved'), entry('sent')] }))).toBe(false);
    expect(canUndo(pkg({ status: 'interview', history: [entry('sent', { messageId: '<m@x>' }), entry('interview', { messageId: '<m@x>' })] }))).toBe(false);
    expect(canUndo(pkg({ status: 'interview', history: [entry('sent', { messageId: '<m@x>' }), entry('interview')] }))).toBe(true);
  });
  it('undoLast pops the entry; the status falls back to the last remaining status entry, else approved', () => {
    const p = pkg({ status: 'rejected', history: [entry('approved'), entry('submitted'), entry('interview'), entry('rejected')] });
    undoLast(p, '2026-10-06T10:00:00.000Z');
    expect(p.status).toBe('interview');
    expect(p.updatedAt).toBe('2026-10-06T10:00:00.000Z');
    undoLast(p, '2026-10-06T10:00:00.000Z');
    undoLast(p, '2026-10-06T10:00:00.000Z');
    expect(p.status).toBe('approved');
    expect(p.history.map((h) => h.kind)).toEqual(['approved']);
    const bare = pkg({ status: 'submitted', history: [entry('submitted')] });
    undoLast(bare, '2026-10-06T10:00:00.000Z');
    expect(bare.status).toBe('approved');
  });
  it('dateToIso gives 12:00 UTC and rejects bad dates', () => {
    const now = new Date('2026-10-05T10:00:00.000Z');
    expect(dateToIso('2026-10-07', now)).toBe('2026-10-07T12:00:00.000Z');
    expect(dateToIso('2025-01-01', now)).toBe('2025-01-01T12:00:00.000Z');
    expect(() => dateToIso('07.10.2026', now)).toThrow(AppError);
    expect(() => dateToIso('2026-02-30', now)).toThrow(AppError);
    expect(() => dateToIso('2027-10-06', now)).toThrow(AppError);
    expect(dateToIso('2027-10-04', now)).toBe('2027-10-04T12:00:00.000Z');
    try { dateToIso('2030-01-01', now); expect.fail('should throw'); } catch (e) { expect((e as AppError).code).toBe('BAD_REQUEST'); }
  });
});
