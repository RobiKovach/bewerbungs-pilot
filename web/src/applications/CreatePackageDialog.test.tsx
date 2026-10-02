import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { appSummary, jobState } from '../test/applicationFixtures';
import { vac, vacancyServer } from '../test/vacancyFixtures';
import { VacanciesPage } from '../pages/VacanciesPage';
import type { NewPackageInfo } from '../types';

const READY = { ready: true, missingSections: [], noStory: false };
const INFO: NewPackageInfo = { suggestedLanguage: 'de', englishBelowB2: true, shortText: false, existingId: null, readiness: READY };

function setup(extra: Record<string, RouteHandler>, applications = [] as ReturnType<typeof appSummary>[]) {
  const server = vacancyServer({ list: [vac({ id: 'v1', status: 'favorite', title: 'Webentwickler (m/w/d)' })] });
  const f = mockFetch({
    ...server.routes,
    'GET /api/applications': () => ({ body: { applications } }),
    'GET /api/applications/readiness': () => ({ body: READY }),
    ...extra,
  });
  render(<SettingsProvider><VacanciesPage pollMs={10} /></SettingsProvider>);
  return { f, user: userEvent.setup() };
}
const favourites = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole('tab', { name: /Favourites/ }));

describe('Create package', () => {
  it('opens the dialog, suggests the language, warns about weak English only for English, creates, then opens the package', async () => {
    let jobCalls = 0;
    const { f, user } = setup({
      'GET /api/applications/new?vacancyId=v1': () => ({ body: INFO }),
      'POST /api/applications': () => ({ status: 202, body: jobState({ state: 'running', kind: 'create', vacancyId: 'v1' }) }),
      'GET /api/applications/job': () => ({ body: jobCalls++ === 0 ? jobState() : jobState({ state: 'done', kind: 'create', vacancyId: 'v1', applicationId: 'app9' }) }),
    });
    await favourites(user);
    await user.click(await screen.findByRole('button', { name: 'Create package' }));
    const dialog = await screen.findByRole('region', { name: 'Create an application package' });
    expect(within(dialog).getByRole('radio', { name: 'Deutsch' })).toBeChecked();
    expect(within(dialog).queryByText(/English is below B2/)).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: 'English' }));
    expect(within(dialog).getByText(/English is below B2/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Deutsch' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    const post = f.mock.calls.find(([url, init]) => url === '/api/applications' && init?.method === 'POST');
    expect(JSON.parse(String(post![1]!.body))).toEqual({ vacancyId: 'v1', language: 'de' });
    await waitFor(() => expect(window.location.hash).toBe('#/applications/app9'));
  });

  it('not ready: the button stays visible but disabled, lists what is missing and links to the profile', async () => {
    const { user } = setup({
      'GET /api/applications/readiness': () => ({ body: { ready: false, missingSections: ['skills'], noStory: true } }),
      'GET /api/applications/job': () => ({ body: jobState() }),
    });
    await favourites(user);
    expect(await screen.findByRole('button', { name: 'Create package' })).toBeDisabled();
    expect(await screen.findByText('Skills')).toBeInTheDocument();
    expect(screen.getByText(/a checked story that may be told/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Complete my profile' })).toHaveAttribute('href', '#/profile');
    expect(screen.queryByRole('region', { name: 'Create an application package' })).toBeNull();
  });

  it('a short offer text gets a warning; a failed job shows its error', async () => {
    let jobCalls = 0;
    const { user } = setup({
      'GET /api/applications/new?vacancyId=v1': () => ({ body: { ...INFO, shortText: true } }),
      'POST /api/applications': () => ({ status: 202, body: jobState({ state: 'running', kind: 'create', vacancyId: 'v1' }) }),
      'GET /api/applications/job': () => ({ body: jobCalls++ === 0 ? jobState() : jobState({ state: 'failed', kind: 'create', vacancyId: 'v1', error: { code: 'PACKAGE_RULES_BROKEN', detailsForLog: '2 rule violation(s) after one retry' } }) }),
    });
    await favourites(user);
    await user.click(await screen.findByRole('button', { name: 'Create package' }));
    const dialog = await screen.findByRole('region', { name: 'Create an application package' });
    expect(within(dialog).getByText(/very short/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText('Claude could not write the letter within the rules.')).toBeInTheDocument();
  });

  it('a favourite that already has a package shows "Open package"', async () => {
    const { user } = setup({ 'GET /api/applications/job': () => ({ body: jobState() }) }, [appSummary({ id: 'app3', vacancyId: 'v1' })]);
    await favourites(user);
    expect(await screen.findByRole('link', { name: 'Open package' })).toHaveAttribute('href', '#/applications/app3');
  });
});
