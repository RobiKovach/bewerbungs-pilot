import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { muteNoSession, onNoSession, reportNoSession } from '../api';
import type { UpdateProgress as Progress, UpdatesView } from '../types';
import { UpdateBanner } from './UpdateBanner';

const AVAILABLE: UpdatesView = {
  current: '0.10.1',
  available: { version: '0.11.0', url: 'https://github.com/RobiKovach/bewerbungs-pilot/releases/tag/v0.11.0', notes: '', canInstall: true },
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const noSession = () => json(401, { error: { code: 'NO_SESSION' } });

/** A scripted server: `progress` and `health` answer the next call (returning a Response = a custom answer, throwing = no connection). */
function server(script: {
  updates?: UpdatesView;
  apply?: () => Response;
  progress: () => Progress | Response;
  health: () => { version: string } | Response;
}) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    calls.push(key);
    if (key === 'GET /api/updates') return json(200, script.updates ?? AVAILABLE);
    if (key === 'POST /api/updates/apply') return script.apply?.() ?? json(202, { state: 'downloading' });
    if (key === 'GET /api/updates/progress') { const r = script.progress(); return r instanceof Response ? r : json(200, r); }
    if (key === 'GET /api/health') { const r = script.health(); return r instanceof Response ? r : json(200, { ok: true, app: 'bewerbungs-pilot', ...r }); }
    return json(404, { error: { code: 'NOT_FOUND' } });
  });
  vi.stubGlobal('fetch', fn);
  return { calls };
}
const gone = (): never => { throw new TypeError('Failed to fetch'); };
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); muteNoSession(false); });

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

async function start() {
  render(<UpdateBanner />);
  await user().click(await screen.findByRole('button', { name: 'Update now' }));
}

describe('UpdateBanner — Update now', () => {
  it('shows the button only when the update can be installed', async () => {
    server({ updates: { current: '0.10.1', available: { ...AVAILABLE.available!, canInstall: false } }, progress: () => ({ state: 'idle' }), health: () => ({ version: '0.10.1' }) });
    render(<UpdateBanner />);
    await screen.findByText('Version 0.11.0 is available');
    expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument();
  });

  it('click posts the request and shows the steps; the old tab shows "Done" once the new server answers', async () => {
    let n = 0;
    let up = false;
    const s = server({
      progress: () => {
        n++;
        if (n === 1) return { state: 'downloading' };
        if (n === 2) return { state: 'verifying' };
        if (n === 3) return { state: 'extracting' };
        if (n === 4) return { state: 'installing' };
        return gone();
      },
      health: () => (up ? { version: '0.11.0' } : gone()),
    });
    let noSessionShown = 0;
    const off = onNoSession(() => { noSessionShown++; });
    await start();
    expect(s.calls).toContain('POST /api/updates/apply');
    expect(await screen.findByText('Downloading…')).toBeInTheDocument();
    await advance(2000);
    expect(screen.getByText('Checking…')).toBeInTheDocument();
    await advance(2000);
    expect(screen.getByText('Installing (a copy of your data is saved first)…')).toBeInTheDocument();
    await advance(1000);
    expect(screen.getByText('Restarting…')).toBeInTheDocument();
    await advance(2000);
    expect(screen.getByText('Restarting…')).toBeInTheDocument();
    up = true;
    await advance(2000);
    expect(screen.getByText('Done — the app opened in a new tab. You can close this one.')).toBeInTheDocument();
    // The new server refuses the old key: the old tab must not switch to the "open via the shortcut" page.
    muteNoSession(true);
    reportNoSession(401, 'NO_SESSION');
    expect(noSessionShown).toBe(0);
    off();
  });

  it('the page is not replaced by the "open via the shortcut" screen while the update runs', async () => {
    let n = 0;
    server({ progress: () => (n++ === 0 ? { state: 'installing' } : noSession()), health: () => ({ version: '0.11.0' }) });
    let noSessionShown = 0;
    const off = onNoSession(() => { noSessionShown++; });
    await start();
    await advance(1000);
    await advance(1000);
    expect(noSessionShown).toBe(0);
    off();
  });

  it('an old version coming back (rollback) is reported as not finished', async () => {
    let n = 0;
    let back = false;
    server({ progress: () => (n++ === 0 ? { state: 'installing' } : gone()), health: () => (back ? { version: '0.10.1' } : gone()) });
    await start();
    await advance(1000);
    await advance(4000);
    back = true;
    await advance(4000);
    expect(screen.getByText('The update did not finish. The old version keeps working and opened in a new tab with the reason.')).toBeInTheDocument();
  });

  it('after 3 minutes without an answer the person is told what to do', async () => {
    let n = 0;
    server({ progress: () => (n++ === 0 ? { state: 'installing' } : gone()), health: () => gone() });
    await start();
    await advance(1000);
    await advance(3 * 60_000 + 4000);
    expect(screen.getByText('If the app opened in a new tab, close this one. Otherwise start it from the shortcut.')).toBeInTheDocument();
  });

  it('a new server that refuses the old key (401) counts as the server being replaced', async () => {
    let n = 0;
    server({ progress: () => (n++ === 0 ? { state: 'installing' } : noSession()), health: () => ({ version: '0.11.0' }) });
    await start();
    await advance(1000);
    await advance(2000);
    await advance(2000);
    expect(screen.getByText('Done — the app opened in a new tab. You can close this one.')).toBeInTheDocument();
  });

  it('a failure before the installer started shows the reason; "Close" goes back to the banner', async () => {
    server({ progress: () => ({ state: 'failed', error: 'updateChecksum' }), health: () => ({ version: '0.10.1' }) });
    await start();
    await advance(1000);
    expect(screen.getByText(/Update failed: The downloaded update does not match the published checksum/)).toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/Update failed/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update now' })).toBeInTheDocument();
  });

  it('a refused start (409 busy) is explained in the banner and nothing is shown over the page', async () => {
    server({
      apply: () => json(409, { error: { code: 'CONFLICT', reason: 'busy', params: { what: 'send' } } }),
      progress: () => ({ state: 'idle' }), health: () => ({ version: '0.10.1' }),
    });
    await start();
    expect(await screen.findByText('An email is still being sent. Please wait until it is finished, then click "Update now" again.')).toBeInTheDocument();
    expect(screen.queryByText('Downloading…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update now' })).toBeEnabled();
  });

  it('the first answer after an update says so; a failed one says why', async () => {
    server({ updates: { current: '0.11.0', available: null, justUpdated: '0.11.0' }, progress: () => ({ state: 'idle' }), health: () => ({ version: '0.11.0' }) });
    const first = render(<UpdateBanner />);
    expect(await screen.findByText('Updated to version 0.11.0.')).toBeInTheDocument();
    first.unmount();
    server({ updates: { current: '0.10.1', available: null, lastUpdateError: 'rollbackFailed' }, progress: () => ({ state: 'idle' }), health: () => ({ version: '0.10.1' }) });
    render(<UpdateBanner />);
    expect(await screen.findByText(/could not be restored automatically/)).toBeInTheDocument();
  });
});
