import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { OnboardingWizard } from './OnboardingWizard';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { baseSettings, settingsRoutes } from '../test/fixtures';
import { emptyProfile, viewOf } from '../test/profileFixtures';
import type { Availability, ProviderId } from '../types';

function setup(currentStep: string | null, availability: Availability = { ok: true }, provider: ProviderId | null = 'claude') {
  const server = settingsRoutes(baseSettings({ onboarding: { currentStep, completed: false }, llm: { timeoutSec: 180, provider } }));
  const check = (id: ProviderId): RouteHandler => () => ({ body: { provider: id, availability, queue: { running: false, queued: 0 } } });
  const f = mockFetch({
    ...server.routes,
    'GET /api/llm/check?provider=claude': check('claude'),
    'GET /api/llm/check?provider=claude&refresh=1': check('claude'),
    'GET /api/llm/check?provider=chatgpt': check('chatgpt'),
    'GET /api/llm/check?provider=chatgpt&refresh=1': check('chatgpt'),
    'POST /api/llm/open-login': () => ({ body: { ok: true } }),
    'GET /api/profile': () => ({ body: viewOf(emptyProfile()) }),
    'GET /api/mail/settings': () => ({ body: { mail: null, passwordSaved: false } }),
    'GET /api/mail/providers': () => ({ body: [] }),
  });
  render(<SettingsProvider><OnboardingWizard /></SettingsProvider>);
  return { server, f, user: userEvent.setup() };
}

describe('OnboardingWizard', () => {
  it('step 1 offers the demo: it opens in a new tab in the chosen language, this tab stays on the real setup', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const { f, user } = setup(null);
    const routes = new Map<string, (init?: RequestInit) => Response>();
    routes.set('POST /api/demo', () => new Response(JSON.stringify({ url: 'http://127.0.0.1:4291/open?key=k' }), { status: 200 }));
    const fallback = f.getMockImplementation();
    f.mockImplementation(async (url: string, init?: RequestInit) => routes.get(`${init?.method ?? 'GET'} ${url}`)?.(init) ?? fallback!(url, init));
    await user.click(await screen.findByRole('button', { name: 'Try the demo' }));
    await waitFor(() => expect(tab.location.href).toBe('http://127.0.0.1:4291/open?key=k'));
    const call = f.mock.calls.find((c) => c[0] === '/api/demo');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ language: 'en' });
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(await screen.findByText(/The demo opened in a new tab/)).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    open.mockRestore();
  });

  it('a failed demo start closes the empty tab and says so', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const { f, user } = setup(null);
    const fallback = f.getMockImplementation();
    f.mockImplementation(async (url: string, init?: RequestInit) => (url === '/api/demo'
      ? new Response(JSON.stringify({ error: { code: 'DEMO_FAILED', detailsForLog: 'x' } }), { status: 500 })
      : fallback!(url, init)));
    await user.click(await screen.findByRole('button', { name: 'Try the demo' }));
    expect(await screen.findByText('The demo could not be started.')).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalled();
    open.mockRestore();
  });

  it('starts at step 1 and moves on, saving progress', async () => {
    const { server, user } = setup(null);
    expect(await screen.findByText('Step 1 of 5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Your AI helper' })).toBeInTheDocument();
    expect(server.current().onboarding.currentStep).toBe('claude');
  });

  it('resumes where the user left off', async () => {
    setup('email');
    expect(await screen.findByText('Step 4 of 5')).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Your email address/)).toBeInTheDocument();
  });

  it('lets the user skip the email step', async () => {
    const { server, user } = setup('email');
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByText('Step 5 of 5')).toBeInTheDocument();
    expect(server.current().onboarding.currentStep).toBe('done');
  });

  it('shows the profile wizard on the profile step and can skip it', async () => {
    const { server, user } = setup('profile');
    expect(await screen.findByText('Step 3 of 5')).toBeInTheDocument();
    expect(await screen.findByText('Step 1 of 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fill in later' }));
    expect(await screen.findByText('Step 4 of 5')).toBeInTheDocument();
    expect(server.current().onboarding.currentStep).toBe('email');
  });

  it('goes back one step', async () => {
    const { server, user } = setup('email');
    await screen.findByText('Step 4 of 5');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Step 3 of 5')).toBeInTheDocument();
    expect(server.current().onboarding.currentStep).toBe('profile');
  });

  it('marks onboarding completed on Finish', async () => {
    const { server, user } = setup('done');
    await user.click(await screen.findByRole('button', { name: 'Finish' }));
    expect(server.current().onboarding).toEqual({ currentStep: null, completed: true });
  });

  it('explains how to sign in and re-checks on demand', async () => {
    const { f, user } = setup('claude', { ok: false, reason: 'not-logged-in' });
    const card = (await screen.findByRole('heading', { name: /^Claude/ })).closest('.ai-card') as HTMLElement;
    expect(await within(card).findByText('Installed, not signed in yet.')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Open sign-in window' }));
    await user.click(within(card).getByRole('button', { name: 'Check again' }));
    const urls = f.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/api/llm/open-login');
    expect(urls).toContain('/api/llm/check?provider=claude&refresh=1');
  });

  it('a new user: Next only once a helper is chosen and ready, "Continue anyway" before that', async () => {
    const { server, user } = setup('claude', { ok: true }, null);
    expect(await screen.findAllByText(/is ready.$/)).toHaveLength(2);
    expect(screen.getByText(/Choose one.$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue anyway' })).toBeInTheDocument();
    const card = screen.getByRole('heading', { name: /^ChatGPT/ }).closest('.ai-card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Choose' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    expect(server.current().llm.provider).toBe('chatgpt');
    expect(screen.queryByRole('button', { name: 'Continue anyway' })).toBeNull();
  });

  it('a new user can continue without a helper', async () => {
    const { server, user } = setup('claude', { ok: false, reason: 'not-installed' }, null);
    await user.click(await screen.findByRole('button', { name: 'Continue anyway' }));
    expect(await screen.findByText('Step 3 of 5')).toBeInTheDocument();
    expect(server.current().llm.provider).toBeNull();
  });

  it('an existing user with Claude ready can go on', async () => {
    setup('claude', { ok: true });
    expect(await screen.findByText('✓ Claude is ready.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});
