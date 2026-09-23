import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { SettingsProvider, useSettings } from './settings';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { mockFetch } from './test/fetchMock';
import { baseSettings, settingsRoutes } from './test/fixtures';

function Probe() {
  const { settings } = useSettings();
  return <span>{`lang:${settings.language}`}</span>;
}

describe('SettingsProvider', () => {
  it('detects the browser language on first start and saves it', async () => {
    Object.defineProperty(window.navigator, 'languages', { value: ['de-DE', 'en'], configurable: true });
    const server = settingsRoutes(baseSettings({ language: null }));
    mockFetch(server.routes);
    render(<SettingsProvider><Probe /></SettingsProvider>);
    expect(await screen.findByText('lang:de')).toBeInTheDocument();
    expect(server.current().language).toBe('de');
    expect(i18n.language).toBe('de');
  });

  it('switches the language instantly and saves it', async () => {
    const server = settingsRoutes(baseSettings({ language: 'en' }));
    mockFetch(server.routes);
    render(<SettingsProvider><LanguageSwitcher /><Probe /></SettingsProvider>);
    await screen.findByText('lang:en');
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'uk');
    expect(await screen.findByText('lang:uk')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Мова' })).toBeInTheDocument();
    expect(server.current().language).toBe('uk');
  });

  it('shows a readable error with retry when the server is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await i18n.changeLanguage('en');
    render(<SettingsProvider><Probe /></SettingsProvider>);
    expect(await screen.findByText('BewerbungsPilot is not running.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });
});
