import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataGate, DataNotice } from './DataGate';
import { SettingsProvider } from './settings';
import { mockFetch } from './test/fetchMock';
import { baseSettings, settingsRoutes } from './test/fixtures';

const backups = { dir: 'D:\\Backups', automatic: true, inOneDrive: false, documentsInOneDrive: false, available: true, backups: [] };

describe('DataGate', () => {
  it('data from a newer version replaces the app with "update" and the backups', async () => {
    mockFetch({
      ...settingsRoutes(baseSettings()).routes,
      'GET /api/data-state': () => ({ body: { newer: true, problems: [] } }),
      'GET /api/backups': () => ({ body: backups }),
      'GET /api/updates': () => ({ body: { available: null } }),
    });
    render(<SettingsProvider><DataGate><p>the app</p></DataGate></SettingsProvider>);
    expect(await screen.findByRole('heading', { name: 'Your data is from a newer version' })).toBeInTheDocument();
    expect(screen.queryByText('the app')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Save backup' })).toBeInTheDocument();
  });

  it('otherwise the app is shown', async () => {
    mockFetch({ 'GET /api/data-state': () => ({ body: { newer: false, problems: [] } }) });
    render(<DataGate><p>the app</p></DataGate>);
    expect(await screen.findByText('the app')).toBeInTheDocument();
  });
});

describe('DataNotice', () => {
  it('names the damaged data and closes for good', async () => {
    let dismissed = 0;
    mockFetch({
      'GET /api/data-state': () => ({ body: { newer: false, problems: ['vacancies', 'profile'] } }),
      'POST /api/data-state/dismiss': () => { dismissed++; return { body: { ok: true } }; },
    });
    render(<DataNotice />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Affected: job offers, profile.');
    await userEvent.setup().click(screen.getByRole('button'));
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(dismissed).toBe(1));
  });
});
