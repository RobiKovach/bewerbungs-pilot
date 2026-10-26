import { describe, it, expect } from 'vitest';
import { submittedByVacancy } from '../applications/format';
import { vac } from '../test/vacancyFixtures';
import { forTab, isWeak, tabCounts, tabOf } from './sort';

const scored = (value: number, over = {}) => vac({ score: { value, why: [], missing: [], scoredAt: '2026-09-28T10:00:00.000Z', provider: 'claude', language: 'en' }, ...over });

describe('sort', () => {
  it('new tab: scored by score, then pending, then not scored / failed; weak ones apart', () => {
    const a = scored(85); const b = scored(40); const c = vac({ scoreState: 'pending', score: null });
    const d = scored(60); const e = vac({ scoreState: 'notScored', score: null }); const f = vac({ scoreState: 'failed', score: null });
    const r = forTab([b, c, e, a, f, d], 'new');
    expect(r.main.map((v) => v.id)).toEqual([a.id, d.id, c.id, e.id, f.id]);
    expect(r.weak.map((v) => v.id)).toEqual([b.id]);
  });
  it('other tabs have no weak block; hidden newest first', () => {
    const fav = scored(30, { status: 'favorite' });
    expect(forTab([fav], 'favorite')).toEqual({ main: [fav], weak: [] });
    const h1 = vac({ status: 'hidden', hiddenAt: '2026-09-27T10:00:00.000Z' });
    const h2 = vac({ status: 'hidden', hiddenAt: '2026-09-28T10:00:00.000Z' });
    expect(forTab([h1, h2], 'hidden').main.map((v) => v.id)).toEqual([h2.id, h1.id]);
  });
  it('counts per tab; weak = scored below 50 only', () => {
    expect(tabCounts([vac(), vac({ status: 'favorite' }), vac({ status: 'hidden' }), vac({ status: 'hidden' })])).toEqual({ new: 1, favorite: 1, submitted: 0, stale: 0, hidden: 2 });
    expect(isWeak(scored(49))).toBe(true);
    expect(isWeak(scored(50))).toBe(false);
    expect(isWeak(vac({ scoreState: 'failed', score: { value: 10, why: [], missing: [], scoredAt: '', provider: 'claude', language: 'en' } }))).toBe(false);
  });
  it('9b: a vacancy added by hand is never weak and comes first in New (newest first); its score stays', () => {
    const high = scored(95);
    const m1 = scored(20, { addedManually: true, source: 'manual', foundAt: '2026-10-01T10:00:00.000Z' });
    const m2 = vac({ addedManually: true, source: 'manual', scoreState: 'notScored', score: null, foundAt: '2026-10-05T10:00:00.000Z' });
    expect(isWeak(m1)).toBe(false);
    const r = forTab([high, m1, m2], 'new');
    expect(r.main.map((v) => v.id)).toEqual([m2.id, m1.id, high.id]);
    expect(r.weak).toEqual([]);
    expect(r.main[1].score?.value).toBe(20);
  });
  it('9b: a vacancy the person applied to moves to "submitted" (newest submission first); hidden stays hidden', () => {
    const fresh = vac(); const fav = vac({ status: 'favorite' }); const stale = vac({ status: 'stale' }); const hidden = vac({ status: 'hidden' }); const other = vac();
    const submitted = new Map([
      [fresh.id, { via: 'site' as const, at: '2026-10-01T12:00:00.000Z' }],
      [fav.id, { via: 'mail' as const, at: '2026-10-03T09:00:00.000Z' }],
      [stale.id, { via: 'mail' as const, at: '2026-10-02T09:00:00.000Z' }],
      [hidden.id, { via: 'mail' as const, at: '2026-10-04T09:00:00.000Z' }],
    ]);
    const list = [fresh, fav, stale, hidden, other];
    expect(tabCounts(list, submitted)).toEqual({ new: 1, favorite: 0, submitted: 3, stale: 0, hidden: 1 });
    expect(forTab(list, 'submitted', submitted).main.map((v) => v.id)).toEqual([fav.id, stale.id, fresh.id]);
    expect(forTab(list, 'new', submitted).main.map((v) => v.id)).toEqual([other.id]);
    expect(tabOf(hidden, submitted)).toBe('hidden');
    expect(tabOf(other, submitted)).toBe('new');
  });
  it('9b: several packages for one vacancy → the earliest submission; never-sent packages do not count', () => {
    const map = submittedByVacancy([
      { id: 'a1', vacancyId: 'v1', submitted: { via: 'mail', at: '2026-10-05T09:00:00.000Z' } },
      { id: 'a2', vacancyId: 'v1', submitted: { via: 'site', at: '2026-10-02T09:00:00.000Z' } },
      { id: 'a3', vacancyId: 'v1', submitted: null },
      { id: 'a4', vacancyId: 'v2', submitted: null },
    ]);
    expect([...map]).toEqual([['v1', { via: 'site', at: '2026-10-02T09:00:00.000Z', applicationId: 'a2' }]]);
  });
});
