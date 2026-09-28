import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { mockFetch } from '../test/fetchMock';
import { searchState, vac, vacancyServer } from '../test/vacancyFixtures';
import { VacanciesPage } from '../pages/VacanciesPage';
import type { SearchState } from '../types';
import { SearchProgress } from './SearchProgress';

const renderPage = () => render(<SettingsProvider><VacanciesPage pollMs={10} /></SettingsProvider>);

describe('SearchProgress (panel only)', () => {
  const panel = (state: SearchState) => render(<SearchProgress status={{ state, startError: null, start: vi.fn(), stop: vi.fn() }} />);

  it('running: phase, counters with reasons, progress, stop', () => {
    panel(searchState({ state: 'running', phase: 'scoring', found: 64, filteredOut: { seen: 20, internship: 9, student: 5 }, afterFilter: 30, toScore: 30, scored: 12 }));
    expect(screen.getByText('Claude is scoring the offers…')).toBeInTheDocument();
    expect(screen.getByText('Found 64 · filtered out 34 (20 already seen, 9 internships, 5 student jobs) · scored 12 of 30')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });
  it('done with more available and warnings', () => {
    panel(searchState({ state: 'done', found: 80, afterFilter: 60, toScore: 50, scored: 50, moreAvailable: 10, warnings: ['someQueriesFailed'] }));
    expect(screen.getByText('Search finished: 50 new offers scored.')).toBeInTheDocument();
    expect(screen.getByText('10 more new offers were found — run the search again to see them.')).toBeInTheDocument();
    expect(screen.getByText('Some searches could not be done. The results may be incomplete.')).toBeInTheDocument();
  });
  it('interrupted, stopped, failed', () => {
    const { unmount } = panel(searchState({ state: 'interrupted' }));
    expect(screen.getByText(/The last search was interrupted/)).toBeInTheDocument();
    unmount();
    const s = panel(searchState({ state: 'stopped', scored: 3, toScore: 9 }));
    expect(screen.getByText(/Search stopped/)).toBeInTheDocument();
    s.unmount();
    panel(searchState({ state: 'failed', error: { code: 'SOURCE_UNAVAILABLE', detailsForLog: 'HTTP 503' } }));
    expect(screen.getByText('The job board of the Federal Employment Agency cannot be reached right now.')).toBeInTheDocument();
  });
  it('idle: nothing', () => {
    const { container } = panel(searchState());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('VacanciesPage — search flow', () => {
  it('start → polls while running and shows new cards → stops polling when done', async () => {
    const server = vacancyServer();
    let current = searchState();
    let polls = 0;
    const f = mockFetch({
      ...server.routes,
      'POST /api/vacancies/search': () => { current = searchState({ state: 'running', phase: 'querying' }); return { status: 202, body: current }; },
      'GET /api/vacancies/search': () => {
        polls++;
        if (polls === 3) { server.list.push(vac({ title: 'Neue Stelle' })); current = searchState({ state: 'running', phase: 'scoring', toScore: 1 }); }
        if (polls === 5) current = searchState({ state: 'done', toScore: 1, scored: 1, finishedAt: '2026-09-28T10:00:00.000Z' });
        return { body: current };
      },
    });
    renderPage();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Search now' }));
    expect(await screen.findByText('Neue Stelle')).toBeInTheDocument();
    expect(await screen.findByText('Search finished: 1 new offers scored.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30)); // the one last list reload after the end
    const afterDone = f.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(f.mock.calls.length).toBe(afterDone);
    expect(screen.getByRole('button', { name: 'Search now' })).toBeEnabled();
  });

  it('does not poll on an idle page', async () => {
    const f = mockFetch(vacancyServer().routes);
    renderPage();
    await screen.findByRole('button', { name: 'Search now' });
    await new Promise((r) => setTimeout(r, 60));
    expect(f.mock.calls.filter((c) => c[0] === '/api/vacancies/search')).toHaveLength(1);
  });

  it('a search that was already running when the page opened is followed; Stop stops it', async () => {
    const server = vacancyServer();
    let current = searchState({ state: 'running', phase: 'details', toScore: 5 });
    mockFetch({
      ...server.routes,
      'GET /api/vacancies/search': () => ({ body: current }),
      'POST /api/vacancies/search/stop': () => { current = searchState({ state: 'stopped', toScore: 5, scored: 0 }); return { body: current }; },
    });
    renderPage();
    expect(await screen.findByText('Loading the offer texts…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search now' })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop' }));
    expect(await screen.findByText(/Search stopped/)).toBeInTheDocument();
  });

  it('a refused start shows the reason', async () => {
    const server = vacancyServer();
    mockFetch({ ...server.routes, 'POST /api/vacancies/search': () => ({ status: 409, body: { error: { code: 'SEARCH_ALREADY_RUNNING', detailsForLog: '' } } }) });
    renderPage();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Search now' }));
    await waitFor(() => expect(screen.getByText('A search is already running.')).toBeInTheDocument());
  });
});
