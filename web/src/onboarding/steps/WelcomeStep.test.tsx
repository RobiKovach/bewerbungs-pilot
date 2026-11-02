import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SettingsProvider } from '../../settings';
import { mockFetch } from '../../test/fetchMock';
import { baseSettings, settingsRoutes } from '../../test/fixtures';
import { WelcomeStep } from './WelcomeStep';

describe('WelcomeStep', () => {
  it('tells new people about the daily report and counts that as the notice (not shown again afterwards)', async () => {
    const server = settingsRoutes(baseSettings({ onboarding: { currentStep: 'welcome', completed: false } }));
    mockFetch(server.routes);
    render(<SettingsProvider><WelcomeStep stepId="welcome" onNext={() => {}} /></SettingsProvider>);
    expect(await screen.findByText(/Once a day the app anonymously reports that it is used/)).toBeInTheDocument();
    await waitFor(() => expect(server.current().usage.noticeShown).toBe(true));
  });
});
