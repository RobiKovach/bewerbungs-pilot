import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { baseSettings, settingsRoutes } from '../test/fixtures';
import type { BackupInfo } from '../types';
import { BackupsSection } from './BackupsSection';

const DIR = 'C:\\Users\\x\\Documents\\BewerbungsPilot\\Backups';

function backup(over: Partial<BackupInfo> = {}): BackupInfo {
  return {
    format: 1, app: 'bewerbungs-pilot', appVersion: '0.9.0', createdAt: '2026-10-20T08:30:00.000Z', kind: 'manual',
    name: 'BewerbungsPilot-backup-2026-10-20-1030.zip', file: `${DIR}\\BewerbungsPilot-backup-2026-10-20-1030.zip`,
    sizeBytes: 2.5 * 1024 * 1024, newer: false, ...over,
  };
}

function setup(routes: Record<string, RouteHandler>, list: BackupInfo[] = [backup()]) {
  const server = settingsRoutes(baseSettings());
  const f = mockFetch({
    ...server.routes,
    'GET /api/backups': () => ({ body: { dir: DIR, backups: list } }),
    'GET /api/mail/settings': () => ({ body: { mail: null, passwordSaved: false } }),
    ...routes,
  });
  render(<SettingsProvider><BackupsSection /></SettingsProvider>);
  return f;
}

const restored = {
  restored: { format: 1, app: 'bewerbungs-pilot', appVersion: '0.9.0', createdAt: '2026-10-20T08:30:00.000Z', kind: 'manual' },
  beforeRestore: backup({ kind: 'before-restore', name: 'BewerbungsPilot-backup-2026-10-21-0900.zip' }),
};

describe('BackupsSection', () => {
  it('shows the folder and the list with date, version, size and kind', async () => {
    setup({}, [
      backup(),
      backup({ name: 'b.zip', kind: 'installer', appVersion: '0.8.5', sizeBytes: 512 * 1024 }),
      backup({ name: 'c.zip', kind: 'before-restore' }),
    ]);
    expect(await screen.findByText(DIR)).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText(/20\.10\.2026/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Version 0\.9\.0/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/2\.5 MB/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/manual/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/before update/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/0\.5 MB/)).toBeInTheDocument();
    expect(within(rows[2]).getByText(/before restore/)).toBeInTheDocument();
  });

  it('"Save backup" adds a row and offers to open the folder', async () => {
    const made = backup({ name: 'BewerbungsPilot-backup-2026-10-21-1200.zip', createdAt: '2026-10-21T10:00:00.000Z' });
    const f = setup({
      'POST /api/backups': () => ({ body: made }),
      'POST /api/backups/open-folder': () => ({ body: { ok: true } }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Save backup' }));
    expect(await screen.findByText(/Saved: BewerbungsPilot-backup-2026-10-21-1200\.zip/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(f.mock.calls.some((c) => c[0] === '/api/backups/open-folder')).toBe(true);
  });

  it('restores only after the confirmation and asks to connect the mail again', async () => {
    const f = setup({
      'POST /api/backups/restore': () => ({ body: restored }),
      'GET /api/mail/settings': () => ({ body: { mail: { type: 'google', address: 'a@gmail.com' }, passwordSaved: false } }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Current data will be replaced. Before that the app saves them as a separate backup.')).toBeInTheDocument();
    expect(f.mock.calls.some((c) => c[0] === '/api/backups/restore')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText(/Backup restored\./)).toBeInTheDocument();
    expect(screen.getByText(/connect your email again/i)).toBeInTheDocument();
    const call = f.mock.calls.find((c) => c[0] === '/api/backups/restore')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ name: 'BewerbungsPilot-backup-2026-10-20-1030.zip' });
  });

  it('cancelling the confirmation restores nothing', async () => {
    const f = setup({ 'POST /api/backups/restore': () => ({ body: restored }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(f.mock.calls.some((c) => c[0] === '/api/backups/restore')).toBe(false);
  });

  it('does not ask about the mail when it is still connected', async () => {
    setup({
      'POST /api/backups/restore': () => ({ body: restored }),
      'GET /api/mail/settings': () => ({ body: { mail: { type: 'google', address: 'a@gmail.com' }, passwordSaved: true } }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText(/Backup restored\./)).toBeInTheDocument();
    expect(screen.queryByText(/connect your email again/i)).toBeNull();
  });

  it('BACKUP_NEWER says to update the app first', async () => {
    setup({ 'POST /api/backups/restore': () => ({ status: 409, body: { error: { code: 'BACKUP_NEWER', detailsForLog: 'x' } } }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Update the app first, then restore this backup.')).toBeInTheDocument();
  });

  it('a backup from a newer version has no restore button', async () => {
    setup({}, [backup({ newer: true, appVersion: '1.2.0' })]);
    expect(await screen.findByText(/Update the app first, then restore this backup\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });

  it('shows what is still running when the restore has to wait', async () => {
    setup({ 'POST /api/backups/restore': () => ({ status: 409, body: { error: { code: 'CONFLICT', detailsForLog: 'busy', reason: 'restoreBusySearch' } } }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText(/A job search is running/)).toBeInTheDocument();
  });

  it('disables every button while restoring', async () => {
    const server = settingsRoutes(baseSettings());
    mockFetch({
      ...server.routes,
      'GET /api/backups': () => ({ body: { dir: DIR, backups: [backup()] } }),
    }, { pending: ['POST /api/backups/restore'] });
    render(<SettingsProvider><BackupsSection /></SettingsProvider>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Restoring…')).toBeInTheDocument();
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
    expect(screen.getByLabelText('Choose file…')).toBeDisabled();
  });

  it('"Choose file…" restores an uploaded zip after the confirmation', async () => {
    const f = setup({ 'POST /api/backups/restore-upload': () => ({ body: restored }) });
    const user = userEvent.setup();
    const file = new File(['zip'], 'my-backup.zip', { type: 'application/zip' });
    await user.upload(await screen.findByLabelText('Choose file…'), file);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/my-backup\.zip/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText(/Backup restored\./)).toBeInTheDocument();
    const call = f.mock.calls.find((c) => c[0] === '/api/backups/restore-upload')!;
    const body = (call[1] as RequestInit).body as FormData;
    expect((body.get('file') as File).name).toBe('my-backup.zip');
  });

  it('a chosen file that is not a .zip is refused with a backup sentence, nothing is sent', async () => {
    const f = setup({ 'POST /api/backups/restore-upload': () => ({ body: restored }) });
    // "All files" in the file dialog lets a person pick anything.
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(await screen.findByLabelText('Choose file…'), new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText(/This is not a backup file\./)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(f.mock.calls.some((c) => c[0] === '/api/backups/restore-upload')).toBe(false);
  });

  it('a chosen file over 1 GB is refused before upload', async () => {
    const f = setup({ 'POST /api/backups/restore-upload': () => ({ body: restored }) });
    const user = userEvent.setup();
    const big = new File(['zip'], 'big.zip', { type: 'application/zip' });
    Object.defineProperty(big, 'size', { value: 1024 * 1024 * 1024 + 1 });
    await user.upload(await screen.findByLabelText('Choose file…'), big);
    expect(await screen.findByText(/larger than 1 GB/)).toBeInTheDocument();
    expect(screen.queryByText(/CV or document/)).toBeNull();
    expect(f.mock.calls.some((c) => c[0] === '/api/backups/restore-upload')).toBe(false);
  });

  it('a too large upload refused by the server shows the backup sentence', async () => {
    setup({ 'POST /api/backups/restore-upload': () => ({ status: 413, body: { error: { code: 'FILE_TOO_LARGE', detailsForLog: 'x', reason: 'backupTooLarge' } } }) });
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText('Choose file…'), new File(['zip'], 'b.zip', { type: 'application/zip' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText(/larger than 1 GB/)).toBeInTheDocument();
  });

  it('a backup deleted meanwhile says so and the list reloads', async () => {
    let lists = 0;
    setup({
      'GET /api/backups': () => { lists++; return { body: { dir: DIR, backups: lists === 1 ? [backup()] : [] } }; },
      'POST /api/backups/restore': () => ({ status: 404, body: { error: { code: 'NOT_FOUND', detailsForLog: 'x', reason: 'backupGone' } } }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText(/no longer in the folder/)).toBeInTheDocument();
    expect(await screen.findByText('No backups yet.')).toBeInTheDocument();
  });

  it('the list reloads after a failed restore (its "before restore" backup may exist)', async () => {
    let lists = 0;
    setup({
      'GET /api/backups': () => { lists++; return { body: { dir: DIR, backups: lists === 1 ? [backup()] : [backup(), backup({ name: 'x.zip', kind: 'before-restore' })] } }; },
      'POST /api/backups/restore': () => ({ status: 500, body: { error: { code: 'BACKUP_FAILED', detailsForLog: 'x' } } }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Restore' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText(/before restore/)).toBeInTheDocument();
  });

  it('shows an empty list', async () => {
    setup({}, []);
    expect(await screen.findByText('No backups yet.')).toBeInTheDocument();
  });
});
