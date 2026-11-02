import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { mockFetch } from '../test/fetchMock';
import { baseSettings, settingsRoutes } from '../test/fixtures';
import { emptyProfile, viewOf } from '../test/profileFixtures';
import { Layout } from './Layout';

function setup(props: { showNav?: boolean; demo?: boolean }) {
  mockFetch({
    ...settingsRoutes(baseSettings({ usage: { ping: true, noticeShown: true } })).routes,
    'GET /api/health': () => ({ body: { ok: true, app: 'BewerbungsPilot', version: '0.11.0' } }),
    'GET /api/updates': () => ({ body: { current: '0.11.0', available: null } }),
    'GET /api/profile': () => ({ body: viewOf(emptyProfile()) }),
    'POST /api/feedback/check-text': () => ({ body: { warnings: [] } }),
  });
  render(<SettingsProvider><Layout route="home" onQuit={() => {}} showNav={props.showNav ?? true} demo={props.demo}>x</Layout></SettingsProvider>);
}

describe('Layout feedback button', () => {
  it('opens and closes the feedback window from the top bar', async () => {
    setup({});
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Feedback' }));
    expect(screen.getByRole('dialog', { name: 'Send feedback' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is not offered during the welcome steps or in the demo', async () => {
    setup({ showNav: false });
    await screen.findByText('x');
    expect(screen.queryByRole('button', { name: 'Feedback' })).not.toBeInTheDocument();
  });

  it('is not offered in the demo', async () => {
    setup({ demo: true });
    await screen.findByText('x');
    expect(screen.queryByRole('button', { name: 'Feedback' })).not.toBeInTheDocument();
  });
});

describe('Layout feedback draft', () => {
  it('keeps the typed text when the window is closed and opened again', async () => {
    setup({});
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Feedback' }));
    await user.type(screen.getByLabelText('Your message'), 'half written');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Feedback' }));
    expect(screen.getByLabelText('Your message')).toHaveValue('half written');
  });
});
