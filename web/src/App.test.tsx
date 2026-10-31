import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('#/settings/ai (the link in AI errors) opens Settings', async () => {
    window.location.hash = '#/settings/ai';
    try {
      mockFetch(settingsRoutes(baseSettings()).routes);
      render(<SettingsProvider><App /></SettingsProvider>);
      expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    } finally {
      window.location.hash = '';
    }
  });

  it('the demo copy says so on every page and closes with "Leave the demo"', async () => {
    const server = settingsRoutes(baseSettings());
    const f = mockFetch({
      ...server.routes,
      'GET /api/health': () => ({ body: { ok: true, app: 'bewerbungs-pilot', version: '0.10.0', demo: true } }),
      'POST /api/shutdown': () => ({ body: { ok: true } }),
    });
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    render(<SettingsProvider><App /></SettingsProvider>);
    const banner = await screen.findByRole('status', { name: 'Demo' });
    expect(banner).toHaveTextContent('Max Mustermann');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Leave the demo' }));
    expect(await screen.findByRole('heading', { name: 'The demo has been closed' })).toBeInTheDocument();
    expect(f.mock.calls.some((c) => c[0] === '/api/shutdown')).toBe(true);
    expect(close).toHaveBeenCalled();
    close.mockRestore();
  });

  it('the real app shows no demo banner', async () => {
    mockFetch({ ...settingsRoutes(baseSettings()).routes, 'GET /api/health': () => ({ body: { ok: true, app: 'bewerbungs-pilot', version: '0.10.0', demo: false } }) });
    render(<SettingsProvider><App /></SettingsProvider>);
    expect(await screen.findByRole('heading', { name: 'Welcome to BewerbungsPilot' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Demo' })).toBeNull();
  });
  it('after setup the real app offers the demo in the top bar: it opens in a new tab, this tab stays as it is', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const f = mockFetch({
      ...settingsRoutes(baseSettings()).routes,
      'GET /api/health': () => ({ body: { ok: true, app: 'bewerbungs-pilot', version: '0.10.0', demo: false } }),
      'POST /api/demo': () => ({ body: { url: 'http://127.0.0.1:4291/open?key=k' } }),
    });
    render(<SettingsProvider><App /></SettingsProvider>);
    expect(await screen.findByRole('heading', { name: 'Welcome to BewerbungsPilot' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try the demo' }));
    await waitFor(() => expect(tab.location.href).toBe('http://127.0.0.1:4291/open?key=k'));
    const call = f.mock.calls.find((c) => c[0] === '/api/demo');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ language: 'en' });
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(screen.getByRole('heading', { name: 'Welcome to BewerbungsPilot' })).toBeInTheDocument();
    open.mockRestore();
  });

  it('the demo copy does not offer another demo', async () => {
    mockFetch({ ...settingsRoutes(baseSettings()).routes, 'GET /api/health': () => ({ body: { ok: true, app: 'bewerbungs-pilot', version: '0.10.0', demo: true } }) });
    render(<SettingsProvider><App /></SettingsProvider>);
    await screen.findByRole('status', { name: 'Demo' });
    expect(screen.queryByRole('button', { name: 'Try the demo' })).toBeNull();
  });
});
