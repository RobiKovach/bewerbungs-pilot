import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { AiHelperCards, CHATGPT_PRIVACY_URL } from './AiHelperCards';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { baseSettings, settingsRoutes } from '../test/fixtures';
import type { Availability, InstallStatus, ProviderId, Settings } from '../types';

type Checks = Record<ProviderId, Availability>;

function setup(opts: {
  checks: Checks; provider?: Settings['llm']['provider']; install?: InstallStatus[]; onReady?: (id: ProviderId) => void;
  /** What GET /api/llm/install answers before anything is posted (default idle); `install` then plays out from there. */
  initialInstall?: InstallStatus; onLoginOffered?: (offered: boolean) => void;
}) {
  const server = settingsRoutes(baseSettings({ llm: { timeoutSec: 180, provider: opts.provider ?? null } }));
  const checks = opts.checks;
  const checkRoute = (id: ProviderId): RouteHandler => () => ({ body: { provider: id, availability: checks[id], queue: { running: false, queued: 0 } } });
  const statuses = [...(opts.install ?? [])];
  let posted = opts.initialInstall?.state === 'running';
  const routes: Record<string, RouteHandler> = {
    ...server.routes,
    'POST /api/llm/open-login': () => ({ body: { ok: true } }),
    'POST /api/llm/install': (init) => { posted = true; return { status: 202, body: { state: 'running', provider: JSON.parse(String(init?.body)).provider } }; },
    'GET /api/llm/install': () => {
      if (!posted) return { body: opts.initialInstall ?? { state: 'idle', provider: null } };
      return { body: statuses.length > 1 ? statuses.shift() : statuses[0] };
    },
  };
  for (const id of ['claude', 'chatgpt'] as const) {
    routes[`GET /api/llm/check?provider=${id}`] = checkRoute(id);
    routes[`GET /api/llm/check?provider=${id}&refresh=1`] = checkRoute(id);
  }
  const f = mockFetch(routes);
  render(<SettingsProvider><AiHelperCards pollMs={10} onReady={opts.onReady} onLoginOffered={opts.onLoginOffered} /></SettingsProvider>);
  return { server, f, checks, user: userEvent.setup() };
}

const card = (name: string) => screen.getByRole('heading', { name: new RegExp(`^${name}`) }).closest('.ai-card') as HTMLElement;
const patches = (f: ReturnType<typeof mockFetch>) =>
  f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH').map((c) => JSON.parse(String((c[1] as RequestInit).body)));

describe('AiHelperCards', () => {
  it('shows both cards with their state', async () => {
    setup({ checks: { claude: { ok: false, reason: 'not-installed' }, chatgpt: { ok: true } } });
    expect(await screen.findByText('Not installed yet.')).toBeInTheDocument();
    expect(screen.getByText('Free with a ChatGPT account; paid plans get more.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How to switch this off' })).toHaveAttribute('href', CHATGPT_PRIVACY_URL);
    expect(await screen.findByText('✓ ChatGPT is ready.')).toBeInTheDocument();
  });

  it('choose -> install -> polls -> done -> re-check -> ready saves the provider', async () => {
    const onReady = vi.fn();
    const { f, checks, server, user } = setup({
      checks: { claude: { ok: false, reason: 'not-installed' }, chatgpt: { ok: false, reason: 'not-installed' } },
      install: [{ state: 'running', provider: 'chatgpt' }, { state: 'done', provider: 'chatgpt' }],
      onReady,
    });
    await within(await waitCard('ChatGPT')).findByText('Not installed yet.');
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Choose' }));
    checks.chatgpt = { ok: true };
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Install' }));
    const post = f.mock.calls.find((c) => c[0] === '/api/llm/install' && (c[1] as RequestInit).method === 'POST')!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ provider: 'chatgpt' });
    expect(await within(card('ChatGPT')).findByText('✓ ChatGPT is ready.')).toBeInTheDocument();
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith('chatgpt'));
    expect(patches(f)).toEqual([{ llm: { provider: 'chatgpt' } }]);
    expect(server.current().llm.provider).toBe('chatgpt');
    expect(f.mock.calls.map((c) => c[0])).toContain('/api/llm/check?provider=chatgpt&refresh=1');
  });

  it('install failure shows the support line', async () => {
    const { user } = setup({
      checks: { claude: { ok: true }, chatgpt: { ok: false, reason: 'not-installed' } },
      provider: 'claude',
      install: [{ state: 'failed', provider: 'chatgpt', detail: 'npm ERR! E404' }],
    });
    await within(await waitCard('ChatGPT')).findByText('Not installed yet.');
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Choose' }));
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Install' }));
    expect(await screen.findByText('Could not install.')).toBeInTheDocument();
    expect(screen.getByText('For support:')).toBeInTheDocument();
    expect(screen.getByText('npm ERR! E404')).toBeInTheDocument();
  });

  it('not signed in -> "Open sign-in window" calls openLogin(chatgpt)', async () => {
    const { f, user } = setup({ checks: { claude: { ok: true }, chatgpt: { ok: false, reason: 'not-logged-in' } }, provider: 'claude' });
    await within(await waitCard('ChatGPT')).findByText('Installed, not signed in yet.');
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Choose' }));
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Open sign-in window' }));
    await vi.waitFor(() => {
      const call = f.mock.calls.find((c) => c[0] === '/api/llm/open-login');
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ provider: 'chatgpt' });
    });
  });

  it('the provider is saved only when the check is ok', async () => {
    const { f, user } = setup({ checks: { claude: { ok: true }, chatgpt: { ok: false, reason: 'not-logged-in' } }, provider: 'claude' });
    await within(await waitCard('ChatGPT')).findByText('Installed, not signed in yet.');
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Choose' }));
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Check again' }));
    expect(await within(card('ChatGPT')).findByText('Installed, not signed in yet.')).toBeInTheDocument();
    expect(patches(f)).toEqual([]);
  });

  it('choosing a helper that is already ready saves it at once', async () => {
    const onReady = vi.fn();
    const { f, user } = setup({ checks: { claude: { ok: true }, chatgpt: { ok: true } }, provider: 'claude', onReady });
    await within(await waitCard('ChatGPT')).findByText('✓ ChatGPT is ready.');
    expect(onReady).toHaveBeenCalledWith('claude');
    expect(patches(f)).toEqual([]);
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Choose' }));
    await vi.waitFor(() => expect(patches(f)).toEqual([{ llm: { provider: 'chatgpt' } }]));
    expect(onReady).toHaveBeenLastCalledWith('chatgpt');
    expect(await within(card('ChatGPT')).findByText('Chosen')).toBeInTheDocument();
  });

  it('an install already running when the cards open is shown and followed to the end', async () => {
    const { checks, f } = setup({
      checks: { claude: { ok: true }, chatgpt: { ok: false, reason: 'not-installed' } },
      provider: 'chatgpt',
      initialInstall: { state: 'running', provider: 'chatgpt' },
      install: [{ state: 'running', provider: 'chatgpt' }, { state: 'done', provider: 'chatgpt' }],
    });
    expect(await within(await waitCard('ChatGPT')).findByText('Installing… this can take a few minutes.')).toBeInTheDocument();
    expect(within(card('ChatGPT')).getByRole('button', { name: 'Install' })).toBeDisabled();
    checks.chatgpt = { ok: true };
    expect(await within(card('ChatGPT')).findByText('✓ ChatGPT is ready.')).toBeInTheDocument();
    expect(f.mock.calls.map((c) => c[0])).toContain('/api/llm/check?provider=chatgpt&refresh=1');
    expect(f.mock.calls.some((c) => c[0] === '/api/llm/install' && (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('a failed save of the choice shows that error, not "did not answer"', async () => {
    const { f, user } = setup({ checks: { claude: { ok: true }, chatgpt: { ok: true } }, provider: 'claude' });
    const real = f.getMockImplementation()!;
    f.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === 'PATCH' && url === '/api/settings'
      ? new Response(JSON.stringify({ error: { code: 'UNKNOWN', detailsForLog: 'disk full' } }), { status: 500 })
      : real(url, init)));
    await within(await waitCard('ChatGPT')).findByText('✓ ChatGPT is ready.');
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Choose' }));
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(within(card('ChatGPT')).getByText('✓ ChatGPT is ready.')).toBeInTheDocument();
    expect(screen.queryByText(/did not answer/)).toBeNull();
  });

  it('install polling never overlaps a slow answer', async () => {
    const { f } = setup({
      checks: { claude: { ok: true }, chatgpt: { ok: false, reason: 'not-installed' } },
      provider: 'chatgpt',
      initialInstall: { state: 'running', provider: 'chatgpt' },
      install: [{ state: 'running', provider: 'chatgpt' }, { state: 'running', provider: 'chatgpt' }, { state: 'running', provider: 'chatgpt' }, { state: 'done', provider: 'chatgpt' }],
    });
    let inFlight = 0;
    let most = 0;
    const real = f.getMockImplementation()!;
    f.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url !== '/api/llm/install') return real(url, init);
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 40)); // slower than the 10 ms poll
      try { return await real(url, init); } finally { inFlight--; }
    });
    await vi.waitFor(() => expect(f.mock.calls.filter((c) => c[0] === '/api/llm/install').length).toBeGreaterThanOrEqual(4), { timeout: 3000 });
    expect(most).toBe(1);
  });

  it('an install that finished but still cannot be found asks for a restart', async () => {
    const { user } = setup({
      checks: { claude: { ok: true }, chatgpt: { ok: false, reason: 'not-installed' } },
      provider: 'claude',
      install: [{ state: 'running', provider: 'chatgpt' }, { state: 'done', provider: 'chatgpt' }],
    });
    await within(await waitCard('ChatGPT')).findByText('Not installed yet.');
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Choose' }));
    await user.click(within(card('ChatGPT')).getByRole('button', { name: 'Install' }));
    expect(await within(card('ChatGPT')).findByText('ChatGPT is installed, but the app cannot find it — restart BewerbungsPilot.')).toBeInTheDocument();
    expect(within(card('ChatGPT')).queryByText('Not installed yet.')).toBeNull();
  });

  it('reports when the saved helper card offers "Open sign-in window"', async () => {
    const onLoginOffered = vi.fn();
    setup({ checks: { claude: { ok: false, reason: 'not-logged-in' }, chatgpt: { ok: true } }, provider: 'claude', onLoginOffered });
    await within(await waitCard('Claude')).findByRole('button', { name: 'Open sign-in window' });
    await vi.waitFor(() => expect(onLoginOffered).toHaveBeenLastCalledWith(true));
  });
});

async function waitCard(name: string) {
  await screen.findByRole('heading', { name: new RegExp(`^${name}`) });
  return card(name);
}
