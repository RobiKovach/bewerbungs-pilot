import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../test/fetchMock';
import { searchState } from '../test/vacancyFixtures';
import { DailySearchBanner } from './DailySearchBanner';

const at = '2026-11-24T08:00:00.000Z';
describe('DailySearchBanner', () => {
  it('announces the new offers; closing is remembered for that run', async () => {
    const seen: unknown[] = [];
    mockFetch({
      'GET /api/vacancies/search': () => ({ body: searchState({ state: 'done', toScore: 7, automatic: true, startedAt: at }) }),
      'POST /api/vacancies/search/seen': (init) => { seen.push(JSON.parse(String(init?.body))); return { body: searchState() }; },
    });
    render(<DailySearchBanner />);
    expect(await screen.findByText('Daily search: new job offers — 7')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show' })).toHaveAttribute('href', '#/vacancies');
    await userEvent.click(screen.getByRole('button'));
    expect(screen.queryByRole('status')).toBeNull();
    await waitFor(() => expect(seen).toEqual([{ startedAt: at }]));
  });
  it.each([
    ['by hand', { state: 'done' as const, toScore: 7 }],
    ['nothing new', { state: 'done' as const, toScore: 0, automatic: true }],
    ['still running', { state: 'running' as const, toScore: 7, automatic: true }],
  ])('silent: %s', async (_n, s) => {
    const f = mockFetch({ 'GET /api/vacancies/search': () => ({ body: searchState(s) }) });
    render(<DailySearchBanner />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
