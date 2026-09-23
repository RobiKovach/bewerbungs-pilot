import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from './settings';
import { App } from './App';
import { mockFetch } from './test/fetchMock';
import { baseSettings, settingsRoutes } from './test/fixtures';

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
});
