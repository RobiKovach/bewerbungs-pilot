import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { OnboardingWizard } from './OnboardingWizard';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { baseSettings, settingsRoutes } from '../test/fixtures';
import type { Availability } from '../types';

function setup(currentStep: string | null, availability: Availability = { ok: true }) {
  const server = settingsRoutes(baseSettings({ onboarding: { currentStep, completed: false } }));
  const check: RouteHandler = () => ({ body: { availability, queue: { running: false, queued: 0 } } });
  const f = mockFetch({ ...server.routes, 'GET /api/llm/check': check, 'GET /api/llm/check?refresh=1': check, 'POST /api/llm/open-login': () => ({ body: { ok: true } }) });
  render(<SettingsProvider><OnboardingWizard /></SettingsProvider>);
  return { server, f, user: userEvent.setup() };
}

describe('OnboardingWizard', () => {
  it('starts at step 1 and moves on, saving progress', async () => {
    const { server, user } = setup(null);
    expect(await screen.findByText('Step 1 of 5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Connect Claude' })).toBeInTheDocument();
    expect(server.current().onboarding.currentStep).toBe('claude');
  });

  it('resumes where the user left off', async () => {
    setup('profile');
    expect(await screen.findByText('Step 3 of 5')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
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
    expect(await screen.findByText('Please sign in to Claude')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open sign-in window' }));
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    const urls = f.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/api/llm/open-login');
    expect(urls).toContain('/api/llm/check?refresh=1');
  });

  it('only enables Next on the Claude step once Claude is ready', async () => {
    setup('claude', { ok: true });
    expect(await screen.findByText('Claude is ready.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});
