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
  ...Object.fromEntries((['claude', 'chatgpt'] as const).flatMap((id) => {
    const h = () => ({ body: { provider: id, availability: { ok: true }, queue: { running: false, queued: 0 } } });
    return [[`GET /api/llm/check?provider=${id}`, h], [`GET /api/llm/check?provider=${id}&refresh=1`, h]];
  })),
  'POST /api/llm/open-login': () => ({ body: { ok: true } }),
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

  it('shows the AI helper cards; "Open sign-in window" acts on the current helper', async () => {
    const server = settingsRoutes(baseSettings());
    const f = mockFetch({ ...server.routes, ...mailRoutes });
    render(<SettingsProvider><SettingsPage onQuit={() => {}} /></SettingsProvider>);
    expect(await screen.findByRole('heading', { name: /^Your AI helper/ })).toBeInTheDocument();
    expect(await screen.findByText('✓ ChatGPT is ready.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Claude/ })).toHaveTextContent('Chosen');
    const buttons = screen.getAllByRole('button', { name: 'Open sign-in window' });
    expect(buttons).toHaveLength(1);
    await userEvent.setup().click(buttons[0]);
    const call = f.mock.calls.find((c) => c[0] === '/api/llm/open-login')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({});
  });

  it('when the chosen helper is not signed in, only its card offers "Open sign-in window"', async () => {
    const server = settingsRoutes(baseSettings());
    const notLoggedIn = () => ({ body: { provider: 'claude', availability: { ok: false, reason: 'not-logged-in' }, queue: { running: false, queued: 0 } } });
    const f = mockFetch({ ...server.routes, ...mailRoutes, 'GET /api/llm/check?provider=claude': notLoggedIn, 'GET /api/llm/check?provider=claude&refresh=1': notLoggedIn });
    render(<SettingsProvider><SettingsPage onQuit={() => {}} /></SettingsProvider>);
    expect(await screen.findByText('Installed, not signed in yet.')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getAllByRole('button', { name: 'Open sign-in window' })).toHaveLength(1));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open sign-in window' }));
    const call = f.mock.calls.find((c) => c[0] === '/api/llm/open-login')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ provider: 'claude' });
  });

  it('without a chosen helper the test is disabled and says so', async () => {
    const server = settingsRoutes(baseSettings({ llm: { timeoutSec: 180, provider: null } }));
    mockFetch({ ...server.routes, ...mailRoutes });
    render(<SettingsProvider><SettingsPage onQuit={() => {}} /></SettingsProvider>);
    expect(await screen.findByText('No AI helper chosen yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test the connection' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Open sign-in window' })).toBeNull();
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
