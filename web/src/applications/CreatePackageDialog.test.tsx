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

function setup(extra: Record<string, RouteHandler>, applications = [] as ReturnType<typeof appSummary>[], list = [vac({ id: 'v1', status: 'favorite', title: 'Webentwickler (m/w/d)' })]) {
  const server = vacancyServer({ list });
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

  it('several packages for one favourite: the one not sent yet is opened, and no new one can be created', async () => {
    const { user } = setup({ 'GET /api/applications/job': () => ({ body: jobState() }) }, [
      appSummary({ id: 'appNew', vacancyId: 'v1', status: 'draft', createdAt: '2026-09-20T10:00:00.000Z' }),
      appSummary({ id: 'appOld', vacancyId: 'v1', status: 'sent', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z' }),
    ]);
    await favourites(user);
    expect(await screen.findByRole('link', { name: 'Open package' })).toHaveAttribute('href', '#/applications/appNew');
    expect(screen.queryByRole('button', { name: 'Create package' })).toBeNull();
  });

  it('all packages of a favourite were sent: "Open package" opens the newest, and a new package can be created', async () => {
    const { user } = setup({
      'GET /api/applications/job': () => ({ body: jobState() }),
      'GET /api/applications/new?vacancyId=v1': () => ({ body: INFO }),
    }, [
      appSummary({ id: 'appA', vacancyId: 'v1', status: 'rejected', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z' }),
      appSummary({ id: 'appB', vacancyId: 'v1', status: 'sent', createdAt: '2026-09-15T10:00:00.000Z', updatedAt: '2026-09-15T10:00:00.000Z' }),
    ]);
    await favourites(user);
    expect(await screen.findByRole('link', { name: 'Open package' })).toHaveAttribute('href', '#/applications/appB');
    await user.click(screen.getByRole('button', { name: 'Create package' }));
    const dialog = await screen.findByRole('region', { name: 'Create an application package' });
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('two favourites: one readiness request and one explanation block', async () => {
    const { f, user } = setup({
      'GET /api/applications/readiness': () => ({ body: { ready: false, missingSections: ['skills'], noStory: false } }),
      'GET /api/applications/job': () => ({ body: jobState() }),
    }, [], [vac({ id: 'v1', status: 'favorite', title: 'Webentwickler (m/w/d)' }), vac({ id: 'v2', status: 'favorite', title: 'Entwickler (m/w/d)' })]);
    await favourites(user);
    expect(await screen.findAllByRole('button', { name: 'Create package' })).toHaveLength(2);
    for (const b of screen.getAllByRole('button', { name: 'Create package' })) expect(b).toBeDisabled();
    expect(screen.getAllByText('Complete my profile')).toHaveLength(1);
    expect(f.mock.calls.filter(([url]) => url === '/api/applications/readiness')).toHaveLength(1);
  });

  it('an existing package found when opening the dialog shows "Open package"', async () => {
    const { user } = setup({
      'GET /api/applications/new?vacancyId=v1': () => ({ body: { ...INFO, existingId: 'app5' } }),
      'GET /api/applications/job': () => ({ body: jobState() }),
    });
    await favourites(user);
    await user.click(await screen.findByRole('button', { name: 'Create package' }));
    const dialog = await screen.findByRole('region', { name: 'Create an application package' });
    expect(within(dialog).getByRole('link', { name: 'Open package' })).toHaveAttribute('href', '#/applications/app5');
  });

  it('a PACKAGE_EXISTS answer to Create (race) offers "Open package"', async () => {
    const { user } = setup({
      'GET /api/applications/new?vacancyId=v1': () => ({ body: INFO }),
      'GET /api/applications/job': () => ({ body: jobState() }),
      'POST /api/applications': () => ({ status: 409, body: { error: { code: 'PACKAGE_EXISTS', detailsForLog: 'exists', params: { id: 'app7' } } } }),
    });
    await favourites(user);
    await user.click(await screen.findByRole('button', { name: 'Create package' }));
    const dialog = await screen.findByRole('region', { name: 'Create an application package' });
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByRole('link', { name: 'Open package' })).toHaveAttribute('href', '#/applications/app7');
  });
});
