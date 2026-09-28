import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from './settings';
import { App } from './App';
import { mockFetch } from './test/fetchMock';
import { baseSettings, settingsRoutes } from './test/fixtures';
import { emptyProfile, viewOf } from './test/profileFixtures';
import { vacancyServer } from './test/vacancyFixtures';

describe('App', () => {
  it('shows the home page and quits cleanly', async () => {
    const server = settingsRoutes(baseSettings());
    const f = mockFetch({ ...server.routes, 'POST /api/shutdown': () => ({ body: { ok: true } }) });
    render(<SettingsProvider><App /></SettingsProvider>);
    expect(await screen.findByRole('heading', { name: 'Welcome to BewerbungsPilot' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Quit' }));
    expect(await screen.findByRole('heading', { name: 'BewerbungsPilot has been closed' })).toBeInTheDocument();
    expect(f.mock.calls.some((c) => c[0] === '/api/shutdown')).toBe(true);
  });

  it('navigates to the guide via the menu', async () => {
    mockFetch(settingsRoutes(baseSettings()).routes);
    render(<SettingsProvider><App /></SettingsProvider>);
    await userEvent.setup().click(await screen.findByRole('link', { name: 'How it works' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'How it works' })).toBeInTheDocument();
  });

  it('opens the profile via the menu', async () => {
    mockFetch({ ...settingsRoutes(baseSettings()).routes, 'GET /api/profile': () => ({ body: viewOf(emptyProfile()) }) });
    render(<SettingsProvider><App /></SettingsProvider>);
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Profile' }));
    expect(await screen.findByText('Step 1 of 4')).toBeInTheDocument();
  });

  it('opens the vacancies page via the menu', async () => {
    mockFetch(vacancyServer().routes);
    render(<SettingsProvider><App /></SettingsProvider>);
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Job offers' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Job offers' })).toBeInTheDocument();
  });
});
