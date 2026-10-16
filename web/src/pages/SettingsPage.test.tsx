import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { SettingsPage } from './SettingsPage';
import { mockFetch } from '../test/fetchMock';
import { baseSettings, settingsRoutes } from '../test/fixtures';

const mailRoutes = {
  'GET /api/mail/settings': () => ({ body: { mail: null, passwordSaved: false } }),
  'GET /api/mail/providers': () => ({ body: [] }),
};

describe('SettingsPage', () => {
  it('tests the Claude connection in the current language', async () => {
    const server = settingsRoutes(baseSettings());
    const f = mockFetch({ ...server.routes, ...mailRoutes, 'POST /api/llm/test': () => ({ body: { greeting: 'Hello there!' } }) });
    render(<SettingsProvider><SettingsPage onQuit={() => {}} /></SettingsProvider>);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Test the connection' }));
    expect(await screen.findByText('Claude says: "Hello there!"')).toBeInTheDocument();
    const call = f.mock.calls.find((c) => c[0] === '/api/llm/test')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ language: 'en' });
  });

  it('shows a readable error when the test fails', async () => {
    const server = settingsRoutes(baseSettings());
    mockFetch({ ...server.routes, ...mailRoutes, 'POST /api/llm/test': () => ({ status: 503, body: { error: { code: 'LLM_NOT_LOGGED_IN', detailsForLog: '' } } }) });
    render(<SettingsProvider><SettingsPage onQuit={() => {}} /></SettingsProvider>);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Test the connection' }));
    expect(await screen.findByText('You are not signed in to Claude.')).toBeInTheDocument();
  });

  it('can cancel a running test', async () => {
    const server = settingsRoutes(baseSettings());
    const routed = mockFetch({ ...server.routes, ...mailRoutes });
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url !== '/api/llm/test') return routed(url, init);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }));
    render(<SettingsProvider><SettingsPage onQuit={() => {}} /></SettingsProvider>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Test the connection' }));
    expect(await screen.findByText('Waiting for Claude…')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Test the connection' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('restarts the welcome steps', async () => {
    const server = settingsRoutes(baseSettings());
    mockFetch({ ...server.routes, ...mailRoutes });
    render(<SettingsProvider><SettingsPage onQuit={() => {}} /></SettingsProvider>);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Show the welcome steps again' }));
    expect(server.current().onboarding).toEqual({ currentStep: 'welcome', completed: false });
  });

  it('quits via the given callback', async () => {
    const server = settingsRoutes(baseSettings());
    mockFetch({ ...server.routes, ...mailRoutes });
    const onQuit = vi.fn();
    render(<SettingsProvider><SettingsPage onQuit={onQuit} /></SettingsProvider>);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Quit BewerbungsPilot' }));
    expect(onQuit).toHaveBeenCalledOnce();
  });
});
