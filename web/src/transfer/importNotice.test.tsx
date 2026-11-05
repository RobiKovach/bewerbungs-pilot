import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { mockFetch } from '../test/fetchMock';
import { baseSettings, settingsRoutes } from '../test/fixtures';
import { dismissImportNotice, ImportNotice, markImported } from './importNotice';

afterEach(() => { act(() => dismissImportNotice()); });

const notice = () => screen.findByRole('status');

describe('ImportNotice', () => {
  it('shows three items once after markImported, a link goes to Settings, closing hides it, a new mount without markImported shows nothing', async () => {
    mockFetch(settingsRoutes(baseSettings()).routes);
    const first = render(<SettingsProvider><ImportNotice /><p>page</p></SettingsProvider>);
    await screen.findByText('page');
    expect(screen.queryByRole('status')).toBeNull();

    act(() => markImported());
    const box = await notice();
    const items = within(box).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/AI helper/);
    expect(items[1]).toHaveTextContent(/email/);
    expect(items[2]).toHaveTextContent(/sent after this file was made/);
    expect(within(items[0]!).getByRole('link')).toHaveAttribute('href', '#/settings');

    await userEvent.click(within(box).getByRole('button'));
    expect(screen.queryByRole('status')).toBeNull();
    first.unmount();

    render(<SettingsProvider><ImportNotice /><p>again</p></SettingsProvider>);
    await screen.findByText('again');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays through a new mount until it is closed (the wizard changes to the home page)', async () => {
    mockFetch(settingsRoutes(baseSettings()).routes);
    act(() => markImported());
    const first = render(<SettingsProvider><ImportNotice /></SettingsProvider>);
    await notice();
    first.unmount();
    render(<SettingsProvider><ImportNotice /></SettingsProvider>);
    expect(await notice()).toBeInTheDocument();
  });

  it('during the welcome steps item 1 is plain text: the menu is hidden, so a link would do nothing', async () => {
    mockFetch(settingsRoutes(baseSettings({ onboarding: { currentStep: 'email', completed: false } })).routes);
    act(() => markImported());
    render(<SettingsProvider><ImportNotice /></SettingsProvider>);
    const box = await notice();
    expect(within(box).getAllByRole('listitem')[0]).toHaveTextContent(/AI helper/);
    expect(within(box).queryByRole('link')).toBeNull();
  });

  it('renders without the settings provider', () => {
    act(() => markImported());
    render(<ImportNotice />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
