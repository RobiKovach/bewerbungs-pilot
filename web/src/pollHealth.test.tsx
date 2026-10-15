import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch } from './test/fetchMock';
import { LOST_AFTER, usePollHealth } from './pollHealth';
import { useSearchStatus } from './vacancies/useSearchStatus';
import { searchState } from './test/vacancyFixtures';

describe('usePollHealth', () => {
  it('lost after LOST_AFTER failures in a row, or at once when the first read fails; any answer clears it', () => {
    const { result } = renderHook(() => usePollHealth());
    for (let i = 1; i < LOST_AFTER; i++) act(() => result.current.failed());
    expect(result.current.lost).toBe(false);
    act(() => result.current.failed());
    expect(result.current.lost).toBe(true);
    act(() => result.current.ok());
    expect(result.current.lost).toBe(false);
    act(() => result.current.failed(true));
    expect(result.current.lost).toBe(true);
  });
});

describe('useSearchStatus', () => {
  it('a search whose status reads keep failing ends up "lost" instead of spinning silently; it recovers on the next answer', async () => {
    let down = false;
    mockFetch({
      'GET /api/vacancies/search': () => (down ? { status: 503, body: { error: { code: 'UNKNOWN', detailsForLog: 'x' } } } : { body: searchState({ state: 'running' }) }),
    });
    const { result } = renderHook(() => useSearchStatus({ onTick: () => {}, pollMs: 5 }));
    await waitFor(() => expect(result.current.state?.state).toBe('running'));
    down = true;
    await waitFor(() => expect(result.current.lost).toBe(true));
    down = false;
    await waitFor(() => expect(result.current.lost).toBe(false));
  });
});
