import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { mockFetch } from '../test/fetchMock';
import { baseSettings, settingsRoutes } from '../test/fixtures';
import type { Settings } from '../types';
import { UsageNotice } from './UsageNotice';

const TEXT = /Once a day the app anonymously reports that it is used/;
const health = (demo: boolean) => () => ({ body: { ok: true, app: 'BewerbungsPilot', version: '0.11.0', ...(demo ? { demo: true } : {}) } });
const settle = () => new Promise((r) => setTimeout(r, 80));

function setup(over: Partial<Settings>, demo = false) {
  const server = settingsRoutes(baseSettings(over));
  mockFetch({ ...server.routes, 'GET /api/health': health(demo) });
  render(<SettingsProvider><UsageNotice /></SettingsProvider>);
  return server;
}

describe('UsageNotice', () => {
  it('shows once after the welcome steps and "OK" remembers it', async () => {
    const server = setup({});
    expect(await screen.findByText(TEXT)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
    await waitFor(() => expect(server.current().usage.noticeShown).toBe(true));
  });

  it('is not shown when it was shown before', async () => {
    setup({ usage: { ping: true, noticeShown: true } });
    await settle();
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
  });

  it('is not shown before the welcome steps are finished', async () => {
    setup({ onboarding: { currentStep: 'welcome', completed: false } });
    await settle();
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
  });

  it('is not shown in the demo', async () => {
    setup({}, true);
    await settle();
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
  });
});
