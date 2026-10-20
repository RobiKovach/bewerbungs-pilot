import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { App } from './App';
import { NoSessionGate, pickBrowserLanguage } from './NoSessionGate';
import { SettingsProvider } from './settings';
import { mockFetch } from './test/fetchMock';
import { baseSettings, settingsRoutes } from './test/fixtures';

const noSession = () => ({ status: 401, body: { error: { code: 'NO_SESSION', detailsForLog: 'missing launch key' } } });

const renderApp = () => render(<NoSessionGate><SettingsProvider><App /></SettingsProvider></NoSessionGate>);

describe('NoSessionGate', () => {
  it('shows the shortcut screen when the very first settings load gets NO_SESSION', async () => {
    mockFetch({ 'GET /api/settings': noSession });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Open BewerbungsPilot with its shortcut' })).toBeInTheDocument();
    expect(screen.queryByText('Check again')).not.toBeInTheDocument();
    expect(screen.queryByText(/is not answering/)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('switches to the shortcut screen when a later request gets NO_SESSION', async () => {
    mockFetch({ ...settingsRoutes(baseSettings()).routes, 'GET /api/profile': noSession });
    renderApp();
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Profile' }));
    expect(await screen.findByRole('heading', { name: 'Open BewerbungsPilot with its shortcut' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument();
  });

  it('shows the screen in the browser language', async () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'languages');
    Object.defineProperty(window.navigator, 'languages', { value: ['de-DE', 'en'], configurable: true });
    try {
      mockFetch({ 'GET /api/settings': noSession });
      renderApp();
      expect(await screen.findByRole('heading', { name: 'BewerbungsPilot über die Verknüpfung öffnen' })).toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(window.navigator, 'languages', original);
      else delete (window.navigator as { languages?: unknown }).languages;
      await i18n.changeLanguage('en');
    }
  });

  it('picks the first supported browser language', () => {
    expect(pickBrowserLanguage(['de-DE', 'en'])).toBe('de');
    expect(pickBrowserLanguage(['fr'])).toBe('en');
    expect(pickBrowserLanguage(['uk'])).toBe('uk');
  });
});
