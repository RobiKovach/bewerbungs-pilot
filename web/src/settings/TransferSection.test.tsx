import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { baseSettings, settingsRoutes } from '../test/fixtures';
import { mockFetch } from '../test/fetchMock';
import { TransferSection } from './TransferSection';

const PW = 'Geheim-Pass-1234';

/** Records what the export request sent; `answer` makes the file or the error. */
async function setup(answer: () => Response = () => new Response('PK-zip', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="BewerbungsPilot-transfer-2026-11-05-1000.zip"' } })) {
  const sent: { body: unknown; headers: HeadersInit | undefined }[] = [];
  const base = mockFetch(settingsRoutes(baseSettings()).routes);
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/transfer/export') {
      sent.push({ body: JSON.parse(String(init?.body)), headers: init?.headers });
      return answer();
    }
    return base(url, init);
  });
  vi.stubGlobal('fetch', fn);
  const create = vi.fn(() => 'blob:x');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<SettingsProvider><TransferSection /></SettingsProvider>);
  await screen.findByRole('button', { name: 'Save file' });
  return { sent, click };
}
const fields = () => ({ pw: screen.getByLabelText(/^Password for the file/), again: screen.getByLabelText('Repeat the password') });
const saveButton = () => screen.getByRole('button', { name: 'Save file' });

afterEach(() => { vi.restoreAllMocks(); });

describe('TransferSection', () => {
  it('saving without a password calls export with null and shows the note about personal data and cloud', async () => {
    const { sent, click } = await setup();
    expect(screen.getByText(/For a cloud folder, set a password/)).toBeInTheDocument();
    await userEvent.click(saveButton());
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({});
    expect(sent[0]!.headers).toMatchObject({ 'X-BP-Client': '1' });
    expect(await screen.findByText(/The browser received the file/)).toBeInTheDocument();
  });

  it('says what the file holds and what it does not', async () => {
    await setup();
    expect(screen.getByText(/profile with photo and documents/)).toBeInTheDocument();
    expect(screen.getByText(/email password and the Google sign-in key are not in the file/)).toBeInTheDocument();
  });

  it('password under 8 characters or a different repeat: save is disabled and nothing is sent', async () => {
    const { sent } = await setup();
    const { pw, again } = fields();
    await userEvent.type(pw, 'abc1234');
    await userEvent.type(again, 'abc1234');
    expect(screen.getByText('The password must have at least 8 characters.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    await userEvent.clear(pw);
    await userEvent.type(pw, PW);
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    await userEvent.click(saveButton());
    expect(sent).toHaveLength(0);
  });

  it('a repeat without a password is a mismatch, not a save without a password', async () => {
    await setup();
    await userEvent.type(fields().again, PW);
    expect(saveButton()).toBeDisabled();
  });

  it('counts characters like the server (code points) and caps at 200', async () => {
    const { sent } = await setup();
    const { pw, again } = fields();
    // 4 emoji = 4 characters (8 UTF-16 units): long enough only with 4 more.
    await userEvent.type(pw, '😀😀😀😀');
    expect(screen.getByText('The password must have at least 8 characters.')).toBeInTheDocument();
    await userEvent.type(pw, '😀😀😀😀');
    await userEvent.type(again, '😀😀😀😀😀😀😀😀');
    expect(saveButton()).toBeEnabled();
    await userEvent.click(saveButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({ password: '😀'.repeat(8) });
  });

  it('over 200 characters: a validation line and no save', async () => {
    const { sent } = await setup();
    const { pw, again } = fields();
    const long = 'x'.repeat(201);
    await userEvent.click(pw);
    await userEvent.paste(long);
    await userEvent.click(again);
    await userEvent.paste(long);
    expect(screen.getByText('The password can have at most 200 characters.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(sent).toHaveLength(0);
  });

  it('the warning "forgotten password cannot be recovered" is visible as soon as a password is typed', async () => {
    await setup();
    expect(screen.queryByText(/cannot be recovered/)).toBeNull();
    await userEvent.type(fields().pw, 'a');
    expect(screen.getByText(/cannot be recovered/)).toBeInTheDocument();
  });

  it('after a successful save both password fields are empty', async () => {
    const { sent } = await setup();
    const { pw, again } = fields();
    await userEvent.type(pw, PW);
    await userEvent.type(again, PW);
    await userEvent.click(saveButton());
    await screen.findByText(/The browser received the file/);
    expect(sent[0]!.body).toEqual({ password: PW });
    expect(pw).toHaveValue('');
    expect(again).toHaveValue('');
  });

  it('an error is shown and the password stays in the fields for another try', async () => {
    await setup(() => new Response(JSON.stringify({ error: { code: 'BACKUP_FAILED', detailsForLog: 'x' } }), { status: 500 }));
    const { pw, again } = fields();
    await userEvent.type(pw, PW);
    await userEvent.type(again, PW);
    await userEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(pw).toHaveValue(PW);
    expect(again).toHaveValue(PW);
    expect(screen.queryByText(/The browser received the file/)).toBeNull();
  });

  it.each([['backupTooLarge', 413, /larger than 1 GB/], ['restoreRunning', 409, /restored right now/]] as const)('reason %s gets its own sentence', async (reason, status, text) => {
    await setup(() => new Response(JSON.stringify({ error: { code: 'CONFLICT', detailsForLog: 'x', reason } }), { status }));
    await userEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('a download cut off half way is an error and nothing is saved', async () => {
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('PK')); c.error(new TypeError('network error')); } });
    const { click } = await setup(() => new Response(body, { status: 200, headers: { 'Content-Disposition': 'attachment; filename="x.zip"' } }));
    await userEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByText(/The browser received the file/)).toBeNull();
  });

  it('fields are type=password with autoComplete="new-password"', async () => {
    await setup();
    for (const el of Object.values(fields())) {
      expect(el).toHaveAttribute('type', 'password');
      expect(el).toHaveAttribute('autocomplete', 'new-password');
    }
  });

  it('the warning and the validation line stand out as warnings', async () => {
    await setup();
    await userEvent.type(fields().pw, 'abc');
    expect(screen.getByText(/cannot be recovered/)).toHaveClass('notice-warn');
    expect(screen.getByText(/at least 8 characters/)).toHaveClass('notice-warn');
  });

  it('holds the import too, outside the save form (forms cannot be nested)', async () => {
    await setup();
    expect(screen.getByLabelText('Choose a file…').closest('form')).toBeNull();
  });

  it('the password is not kept in the browser storage', async () => {
    await setup();
    await userEvent.type(fields().pw, PW);
    expect(JSON.stringify({ ...localStorage })).not.toContain(PW);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(PW);
  });
});
