import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { baseSettings, settingsRoutes } from '../test/fixtures';
import { dismissImportNotice, ImportNotice } from './importNotice';
import { isEncryptedBlob, TransferImport } from './TransferImport';

const RESTORE = '/api/backups/restore-upload';
const PW = 'Geheim-Pass-1234';
const restored = { restored: { format: 1 }, beforeRestore: { name: 'before.zip' } };

const plainFile = (name = 'BewerbungsPilot-transfer.zip') => new File(['PK-zip'], name, { type: 'application/zip' });
const encryptedFile = (name = 'BewerbungsPilot-transfer-encrypted.zip') => new File(['BPENC', 'rest'], name, { type: 'application/zip' });

function setup(routes: Record<string, RouteHandler> = {}, opts: { hasData?: boolean; onDone?: () => void; pending?: string[] } = {}) {
  const server = settingsRoutes(baseSettings());
  const f = mockFetch({
    ...server.routes,
    'GET /api/transfer/status': () => ({ body: { hasData: opts.hasData ?? false } }),
    [`POST ${RESTORE}`]: () => ({ body: restored }),
    ...routes,
  }, { pending: opts.pending });
  render(<SettingsProvider><ImportNotice /><TransferImport onDone={opts.onDone} /></SettingsProvider>);
  const sent = () => f.mock.calls.filter((c) => c[0] === RESTORE);
  return { f, sent };
}
const choose = async (file: File, user = userEvent.setup({ applyAccept: false })) => {
  await user.upload(await screen.findByLabelText('Choose a file…'), file);
  return user;
};
const openButton = () => screen.findByRole('button', { name: 'Open file' });
const replaceButton = () => screen.findByRole('button', { name: 'Replace data and open' });
const bodyOf = (call: unknown[]) => (call[1] as RequestInit).body as FormData;

afterEach(() => { act(() => dismissImportNotice()); vi.restoreAllMocks(); });

describe('isEncryptedBlob', () => {
  it('is true only when the first 5 bytes are BPENC', async () => {
    expect(await isEncryptedBlob(new Blob(['BPENC', 'x']))).toBe(true);
    expect(await isEncryptedBlob(new Blob(['BPENC']))).toBe(true);
    expect(await isEncryptedBlob(new Blob(['PK-zip']))).toBe(false);
    expect(await isEncryptedBlob(new Blob(['BPE']))).toBe(false);
    expect(await isEncryptedBlob(new Blob([]))).toBe(false);
  });
});

describe('TransferImport', () => {
  it('plain file, empty PC: restores with no replace warning', async () => {
    const { sent } = setup();
    const user = await choose(plainFile());
    expect(await screen.findByText('BewerbungsPilot-transfer.zip')).toBeInTheDocument();
    expect(screen.queryByText(/will be replaced/)).toBeNull();
    await user.click(await openButton());
    await waitFor(() => expect(sent()).toHaveLength(1));
    const body = bodyOf(sent()[0]!);
    expect((body.get('file') as File).name).toBe('BewerbungsPilot-transfer.zip');
    expect(body.has('password')).toBe(false);
  });

  it('plain file, PC has data: the replace warning must be confirmed first; Cancel sends nothing', async () => {
    const { sent } = setup({}, { hasData: true });
    const user = await choose(plainFile());
    expect(await screen.findByText(/will be replaced.*A copy of the current data is saved first/)).toBeInTheDocument();
    expect(sent()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/will be replaced/)).toBeNull();
    expect(screen.queryByText('BewerbungsPilot-transfer.zip')).toBeNull();
    expect(sent()).toHaveLength(0);

    await choose(plainFile(), user);
    await user.click(await replaceButton());
    await waitFor(() => expect(sent()).toHaveLength(1));
  });

  it('status check failed: fail safe and show the warning', async () => {
    setup({ 'GET /api/transfer/status': () => ({ status: 500, body: { error: { code: 'UNKNOWN', detailsForLog: 'x' } } }) });
    await choose(plainFile());
    expect(await screen.findByText(/will be replaced/)).toBeInTheDocument();
  });

  it('encrypted file asks for the password; plain file does not', async () => {
    setup();
    const user = await choose(plainFile());
    await openButton();
    expect(screen.queryByLabelText('Password for this file')).toBeNull();
    await choose(encryptedFile(), user);
    const field = await screen.findByLabelText('Password for this file');
    expect(field).toHaveAttribute('type', 'password');
    expect(await openButton()).toBeDisabled();
  });

  it('encrypted file with data on the PC: password and warning on one screen, one button; the password goes before the file and is not trimmed', async () => {
    const { sent } = setup({}, { hasData: true });
    const user = await choose(encryptedFile());
    const field = await screen.findByLabelText('Password for this file');
    expect(screen.getByText(/will be replaced/)).toBeInTheDocument();
    await user.type(field, ' kurz ');
    await user.click(await replaceButton());
    await waitFor(() => expect(sent()).toHaveLength(1));
    const body = bodyOf(sent()[0]!);
    expect(body.get('password')).toBe(' kurz ');
    expect([...body.keys()]).toEqual(['password', 'file']);
  });

  it('wrong password: reason transferCannotOpen is shown, the file stays chosen, a new password can be sent', async () => {
    let tries = 0;
    const { sent } = setup({
      [`POST ${RESTORE}`]: () => {
        tries++;
        return tries === 1
          ? { status: 422, body: { error: { code: 'BACKUP_INVALID', detailsForLog: 'x', reason: 'transferCannotOpen' } } }
          : { body: restored };
      },
    });
    const user = await choose(encryptedFile());
    const field = await screen.findByLabelText('Password for this file');
    await user.type(field, 'falsch-falsch');
    await user.click(await openButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/password is wrong or the file is damaged.*not changed/);
    expect(screen.getByText('BewerbungsPilot-transfer-encrypted.zip')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, PW);
    await user.click(await openButton());
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(bodyOf(sent()[1]!).get('password')).toBe(PW);
  });

  it('choosing another file clears the password', async () => {
    setup();
    const user = await choose(encryptedFile());
    await user.type(await screen.findByLabelText('Password for this file'), PW);
    await choose(encryptedFile('other-encrypted.zip'), user);
    await screen.findByText('other-encrypted.zip');
    expect(await screen.findByLabelText('Password for this file')).toHaveValue('');
  });

  it('newer file: BACKUP_NEWER shows the "update the app first" text', async () => {
    setup({ [`POST ${RESTORE}`]: () => ({ status: 409, body: { error: { code: 'BACKUP_NEWER', detailsForLog: 'x' } } }) });
    const user = await choose(plainFile());
    await user.click(await openButton());
    expect(await screen.findByText('Update the app first, then restore this backup.')).toBeInTheDocument();
  });

  it('a busy reason shows its own sentence', async () => {
    setup({ [`POST ${RESTORE}`]: () => ({ status: 409, body: { error: { code: 'CONFLICT', detailsForLog: 'x', reason: 'restoreBusySearch' } } }) });
    const user = await choose(plainFile());
    await user.click(await openButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/A job search is running/);
  });

  it('the server finds a password the page could not see: the password field appears instead of an error', async () => {
    setup({ [`POST ${RESTORE}`]: () => ({ status: 422, body: { error: { code: 'BACKUP_INVALID', detailsForLog: 'x', reason: 'transferPasswordNeeded' } } }) });
    const user = await choose(plainFile());
    await user.click(await openButton());
    expect(await screen.findByLabelText('Password for this file')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('not a .zip or over 1 GB: refused before any request', async () => {
    const { f, sent } = setup();
    const user = await choose(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/This is not a backup file/);
    const big = plainFile('big.zip');
    Object.defineProperty(big, 'size', { value: 1024 * 1024 * 1024 + 1 });
    await choose(big, user);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/larger than 1 GB/));
    expect(sent()).toHaveLength(0);
    expect(f.mock.calls.some((c) => c[0] === '/api/transfer/status')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Open file' })).toBeNull();
  });

  it('the input is reset so the same file can be chosen again, and takes zip files', async () => {
    setup();
    const input = await screen.findByLabelText<HTMLInputElement>('Choose a file…');
    expect(input).toHaveAttribute('accept', '.zip,application/zip');
    await choose(plainFile());
    await openButton();
    expect(input.value).toBe('');
  });

  it('a failed settings reload after a successful import still shows success and calls onDone', async () => {
    const onDone = vi.fn();
    let reads = 0;
    setup({ 'GET /api/settings': () => { reads++; return reads === 1 ? { body: baseSettings() } : { status: 500, body: { error: { code: 'UNKNOWN', detailsForLog: 'x' } } }; } }, { onDone });
    const user = await choose(plainFile());
    await user.click(await openButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(screen.getByText(/File opened/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('success calls settings reload and markImported, and clears the password', async () => {
    const onDone = vi.fn();
    const { f } = setup({}, { onDone });
    const user = await choose(encryptedFile());
    await user.type(await screen.findByLabelText('Password for this file'), PW);
    const settingsReads = () => f.mock.calls.filter((c) => c[0] === '/api/settings').length;
    const before = settingsReads();
    await user.click(await openButton());
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(settingsReads()).toBe(before + 1);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByLabelText('Password for this file')).toBeNull();
    expect(screen.queryByText('BewerbungsPilot-transfer-encrypted.zip')).toBeNull();
    expect(screen.getByText(/File opened/)).toBeInTheDocument();
    // Nothing keeps the password: choosing the file again starts empty.
    await choose(encryptedFile(), user);
    expect(await screen.findByLabelText('Password for this file')).toHaveValue('');
  });

  it('while importing the controls are disabled and a status line shows', async () => {
    setup({}, { pending: [`POST ${RESTORE}`] });
    const user = await choose(encryptedFile());
    const field = await screen.findByLabelText('Password for this file');
    await user.type(field, PW);
    await user.click(await openButton());
    expect(await screen.findByText(/Opening the file/)).toBeInTheDocument();
    expect(field).toBeDisabled();
    expect(screen.getByLabelText('Choose a file…')).toBeDisabled();
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('the password is not kept in the browser storage', async () => {
    setup();
    const user = await choose(encryptedFile());
    await user.type(await screen.findByLabelText('Password for this file'), PW);
    expect(JSON.stringify({ ...localStorage })).not.toContain(PW);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(PW);
  });
});

describe('TransferImport without the settings provider', () => {
  it('does not crash and still marks the import', async () => {
    mockFetch({
      'GET /api/transfer/status': () => ({ body: { hasData: false } }),
      [`POST ${RESTORE}`]: () => ({ body: restored }),
    });
    render(<><ImportNotice /><TransferImport /></>);
    const user = await choose(plainFile());
    await user.click(await openButton());
    expect(await screen.findByText(/File opened/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
