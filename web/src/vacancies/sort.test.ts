import { describe, it, expect } from 'vitest';
import { vac } from '../test/vacancyFixtures';
import { forTab, isWeak, tabCounts } from './sort';

const scored = (value: number, over = {}) => vac({ score: { value, why: [], missing: [], scoredAt: '2026-09-28T10:00:00.000Z' }, ...over });

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
    expect(tabCounts([vac(), vac({ status: 'favorite' }), vac({ status: 'hidden' }), vac({ status: 'hidden' })])).toEqual({ new: 1, favorite: 1, stale: 0, hidden: 2 });
    expect(isWeak(scored(49))).toBe(true);
    expect(isWeak(scored(50))).toBe(false);
    expect(isWeak(vac({ scoreState: 'failed', score: { value: 10, why: [], missing: [], scoredAt: '' } }))).toBe(false);
  });
});
