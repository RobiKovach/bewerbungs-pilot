import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../test/fetchMock';
import { searchState } from '../test/vacancyFixtures';
import { SearchProgress } from './SearchProgress';
import { SimilarTitles } from './SimilarTitles';

const LIST = { titles: [{ title: 'TYPO3-Entwickler', why: 'TYPO3' }, { title: 'Web Developer', why: 'web' }, { title: 'Frontend', why: 'f' }] };
const routes = { 'POST /api/vacancies/similar-titles': () => ({ body: LIST }) };
const ask = () => userEvent.click(screen.getByRole('button', { name: 'Suggest similar titles' }));

describe('SimilarTitles', () => {
  it('nothing is added before the person ticks; a title already wished is not offered; only as many as still fit', async () => {
    mockFetch(routes);
    const onAdd = vi.fn(async () => true);
    render(<SimilarTitles titles={['frontend']} free={1} disabled={false} onAdd={onAdd} />);
    await ask();
    expect(await screen.findByText('TYPO3-Entwickler')).toBeInTheDocument();
    expect(screen.queryByText('Frontend')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add chosen (0)' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /TYPO3/ }));
    expect(screen.getByRole('checkbox', { name: /Web Developer/ })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Add chosen (1)' }));
    expect(onAdd).toHaveBeenCalledWith(['TYPO3-Entwickler']);
    expect(screen.queryByText('TYPO3-Entwickler')).toBeNull();
  });
  it('saving failed: the list stays; an AI error is shown', async () => {
    mockFetch(routes);
    const { unmount } = render(<SimilarTitles titles={[]} free={5} disabled={false} onAdd={async () => false} />);
    await ask();
    await userEvent.click(await screen.findByRole('checkbox', { name: /TYPO3/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add chosen (1)' }));
    expect(screen.getByRole('checkbox', { name: /TYPO3/ })).toBeChecked();
    unmount();
    mockFetch({ 'POST /api/vacancies/similar-titles': () => ({ status: 429, body: { error: { code: 'LLM_LIMIT', detailsForLog: '' } } }) });
    render(<SimilarTitles titles={[]} free={5} disabled={false} onAdd={async () => true} />);
    await ask();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
  it('the search result names titles with nothing new from 3 days on', () => {
    const day = '2026-11-24';
    render(<SearchProgress status={{ state: searchState({ state: 'done', titleRuns: [{ title: 'A', runs: 3, day }, { title: 'B', runs: 2, day }] }), startError: null, start: vi.fn(), stop: vi.fn(), lost: false, recheck: vi.fn() }} />);
    expect(screen.getByText(/Nothing new for at least 3 search days: “A”\./)).toBeInTheDocument();
  });
});
