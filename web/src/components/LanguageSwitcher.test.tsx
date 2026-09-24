import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsProvider } from '../settings';
import { WelcomeStep } from '../onboarding/steps/WelcomeStep';
import { mockFetch } from '../test/fetchMock';
import { baseSettings, settingsRoutes } from '../test/fixtures';

describe('LanguageSwitcher markup', () => {
  it('uses block containers only, so the error banner (a div) never lands inside a <p> or <span>', async () => {
    mockFetch(settingsRoutes(baseSettings({ language: 'en' })).routes);
    const { container } = render(<SettingsProvider><WelcomeStep stepId="welcome" onNext={() => {}} /></SettingsProvider>);
    const select = await screen.findByRole('combobox', { name: 'Language' });
    expect(select.closest('p')).toBeNull();
    expect(select.closest('span')).toBeNull();
    expect(container.querySelector('p .lang-switch, span .lang-switch')).toBeNull();
  });
});
