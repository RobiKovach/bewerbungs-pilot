import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../test/fetchMock';
import type { UpdatesView } from '../types';
import { UpdateBanner } from './UpdateBanner';

const URL_091 = 'https://github.com/RobiKovach/bewerbungs-pilot/releases/tag/v0.9.1';

function available(notes = 'Faster search. <b>Not bold</b>'): UpdatesView {
  return { current: '0.9.0', available: { version: '0.9.1', url: URL_091, notes } };
}

describe('UpdateBanner', () => {
  it('shows the new version with "What\'s new", "Download" and "×"', async () => {
    mockFetch({ 'GET /api/updates': () => ({ body: available() }) });
    render(<UpdateBanner />);
    expect(await screen.findByText('Version 0.9.1 is available')).toBeInTheDocument();
    const download = screen.getByRole('link', { name: 'Download' });
    expect(download).toHaveAttribute('href', URL_091);
    expect(download).toHaveAttribute('target', '_blank');
    expect(download).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Hide until the next version' })).toHaveTextContent('×');
  });

  it('"What\'s new" expands the notes as plain text', async () => {
    mockFetch({ 'GET /api/updates': () => ({ body: available() }) });
    const { container } = render(<UpdateBanner />);
    const toggle = await screen.findByRole('button', { name: "What's new" });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Faster search/)).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Faster search. <b>Not bold</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('has no "What\'s new" button when the notes are empty', async () => {
    mockFetch({ 'GET /api/updates': () => ({ body: available('') }) });
    render(<UpdateBanner />);
    await screen.findByText('Version 0.9.1 is available');
    expect(screen.queryByRole('button', { name: "What's new" })).not.toBeInTheDocument();
  });

  it('"×" asks the server to remember the version and hides the banner', async () => {
    const f = mockFetch({
      'GET /api/updates': () => ({ body: available() }),
      'POST /api/updates/dismiss': () => ({ body: null }),
    });
    render(<UpdateBanner />);
    await userEvent.click(await screen.findByRole('button', { name: 'Hide until the next version' }));
    expect(screen.queryByText('Version 0.9.1 is available')).not.toBeInTheDocument();
    const call = f.mock.calls.find(([url, init]) => url === '/api/updates/dismiss' && init?.method === 'POST');
    expect(call).toBeDefined();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ version: '0.9.1' });
  });

  it('hides the banner even when remembering the version fails', async () => {
    mockFetch({
      'GET /api/updates': () => ({ body: available() }),
      'POST /api/updates/dismiss': () => ({ status: 500, body: { error: { code: 'INTERNAL' } } }),
    });
    render(<UpdateBanner />);
    await userEvent.click(await screen.findByRole('button', { name: 'Hide until the next version' }));
    expect(screen.queryByText('Version 0.9.1 is available')).not.toBeInTheDocument();
    expect(document.querySelector('.error-banner')).toBeNull();
  });

  it('shows nothing when there is no new version', async () => {
    const f = mockFetch({ 'GET /api/updates': () => ({ body: { current: '0.9.0', available: null } }) });
    const { container } = render(<UpdateBanner />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing and no error when the check fails', async () => {
    const f = mockFetch({ 'GET /api/updates': () => ({ status: 500, body: { error: { code: 'INTERNAL' } } }) });
    const { container } = render(<UpdateBanner />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(container).toBeEmptyDOMElement();
  });

  it('asks again every 6 hours while the app is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let view: UpdatesView = { current: '0.9.0', available: null };
      const f = mockFetch({ 'GET /api/updates': () => ({ body: view }) });
      render(<UpdateBanner />);
      await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
      view = available();
      await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000); });
      expect(f).toHaveBeenCalledTimes(2);
      expect(await screen.findByText('Version 0.9.1 is available')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
