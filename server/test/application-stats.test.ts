import { describe, it, expect } from 'vitest';
import { applicationStats } from '../src/applications/stats.js';
import { H, makeApp } from './helpers/app.js';
import { pkg } from './helpers/applications.js';

const NOW = new Date(2026, 9, 7, 12);

describe('application statistics', () => {
  it('nothing sent: zeros, rates null, 8 empty weeks ending with this week', () => {
    const s = applicationStats([pkg({ status: 'draft' })], NOW);
    expect(s).toMatchObject({ sent: 0, replies: 0, interviews: 0, offers: 0, rates: null });
    expect(s.weeks).toHaveLength(8);
    expect(s.weeks.at(-1)).toEqual({ start: '2026-10-05', count: 0 });
    expect(s.weeks[0].start).toBe('2026-08-17');
  });
  it('counts packages, not entries; replies = interview/rejected/offer anywhere in the history', () => {
    const day = (d: number) => new Date(2026, 9, d, 12).toISOString();
    const s = applicationStats([
      pkg({ status: 'sent', history: [{ kind: 'sent', at: day(6) }, { kind: 'followUp', at: day(7) }] }),
      pkg({ status: 'interview', history: [{ kind: 'submitted', at: day(1) }, { kind: 'interview', at: day(2) }, { kind: 'interview', at: day(4) }] }),
      pkg({ status: 'withdrawn', history: [{ kind: 'sent', at: day(1) }, { kind: 'offer', at: day(3) }, { kind: 'withdrawn', at: day(5) }] }),
      pkg({ status: 'rejected', history: [{ kind: 'sent', at: new Date(2026, 6, 1, 12).toISOString() }, { kind: 'rejected', at: day(2) }] }),
      pkg({ status: 'approved' }),
    ], NOW);
    expect(s).toMatchObject({ sent: 4, replies: 3, interviews: 1, offers: 1 });
    expect(s.rates).toEqual({ reply: 0.75, interview: 0.25, offer: 0.25 });
    expect(s.weeks.at(-1)!.count).toBe(1);
    expect(s.weeks.at(-2)!.count).toBe(2);
    expect(s.weeks.reduce((n, w) => n + w.count, 0)).toBe(3);
  });
  it('a Sunday belongs to the week that started on Monday', () => {
    const sunday = pkg({ status: 'sent', history: [{ kind: 'sent', at: new Date(2026, 9, 4, 23).toISOString() }] });
    expect(applicationStats([sunday], NOW).weeks.at(-2)).toEqual({ start: '2026-09-28', count: 1 });
  });
  it('GET /api/applications/stats on an empty store', async () => {
    const ctx = await makeApp();
    const r = await ctx.app.inject({ method: 'GET', url: '/api/applications/stats', headers: H });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ sent: 0, rates: null });
  });
});
