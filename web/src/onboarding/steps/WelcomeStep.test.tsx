import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../../settings';
import { mockFetch } from '../../test/fetchMock';
import { baseSettings, settingsRoutes } from '../../test/fixtures';
import { WelcomeStep } from './WelcomeStep';

const DEMO = /demo/i;

describe('WelcomeStep', () => {
  it('tells new people about the daily report and counts that as the notice (not shown again afterwards)', async () => {
    const server = settingsRoutes(baseSettings({ onboarding: { currentStep: 'welcome', completed: false } }));
    mockFetch(server.routes);
    render(<SettingsProvider><WelcomeStep stepId="welcome" onNext={() => {}} /></SettingsProvider>);
    expect(await screen.findByText(/Once a day the app anonymously reports that it is used/)).toBeInTheDocument();
    await waitFor(() => expect(server.current().usage.noticeShown).toBe(true));
  });

  it('"I already have a file" opens the import, under "Next" and above the demo offer', async () => {
    mockFetch(settingsRoutes(baseSettings({ onboarding: { currentStep: 'welcome', completed: false } })).routes);
    render(<SettingsProvider><WelcomeStep stepId="welcome" onNext={() => {}} /></SettingsProvider>);
    const button = await screen.findByRole('button', { name: 'I already have a file' });
    const next = screen.getByRole('button', { name: 'Next' });
    const demo = screen.getByRole('button', { name: DEMO });
    expect(next.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(demo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText('Choose a file…')).toBeNull();
    await userEvent.click(button);
    expect(screen.getByLabelText('Choose a file…')).toBeInTheDocument();
  });

  it('"Next" waits while the file is being opened', async () => {
    mockFetch({
      ...settingsRoutes(baseSettings({ onboarding: { currentStep: 'welcome', completed: false } })).routes,
      'GET /api/transfer/status': () => ({ body: { hasData: false } }),
    }, { pending: ['POST /api/backups/restore-upload'] });
    render(<SettingsProvider><WelcomeStep stepId="welcome" onNext={() => {}} /></SettingsProvider>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'I already have a file' }));
    await user.upload(screen.getByLabelText('Choose a file…'), new File(['PK'], 'a.zip', { type: 'application/zip' }));
    await user.click(await screen.findByRole('button', { name: 'Open file' }));
    await screen.findByText(/Opening the file/);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('the demo copy does not offer it: its data folder is not the data of the person', async () => {
    mockFetch({
      ...settingsRoutes(baseSettings({ onboarding: { currentStep: 'welcome', completed: false } })).routes,
      'GET /api/health': () => ({ body: { ok: true, app: 'bewerbungs-pilot', version: '1', demo: true } }),
    });
    render(<SettingsProvider><WelcomeStep stepId="welcome" onNext={() => {}} /></SettingsProvider>);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'I already have a file' })).toBeNull());
  });
});
