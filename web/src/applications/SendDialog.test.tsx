import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { appView } from '../test/applicationFixtures';
import { SendDialog } from './SendDialog';
import type { SendDraft } from '../api';

const draft = (over: Partial<SendDraft> = {}): SendDraft => ({
  to: 'jobs@muster.example', subject: 'Bewerbung als Webentwickler', body: 'Sehr geehrte Damen und Herren,\n\nanbei meine Bewerbung.',
  attachments: [{ name: 'Anschreiben_Max_Mustermann.pdf', size: 100_000 }, { name: 'Lebenslauf_Max_Mustermann.pdf', size: 150_000 }],
  totalSize: 250_000, mailReady: true, ...over,
});

function setup(routes: Record<string, RouteHandler> = {}, d: SendDraft = draft()) {
  const onSent = vi.fn();
  const onClose = vi.fn();
  const f = mockFetch({ 'GET /api/applications/app1/send-draft': () => ({ body: d }), ...routes });
  render(<SendDialog id="app1" onSent={onSent} onClose={onClose} />);
  return { f, onSent, onClose, user: userEvent.setup() };
}

describe('SendDialog', () => {
  it('is prefilled and sends what the person edited', async () => {
    const { f, onSent, user } = setup({ 'POST /api/applications/app1/send': () => ({ body: appView({}, { status: 'sent' }) }) });
    const subject = await screen.findByLabelText('Subject');
    expect(screen.getByLabelText(/^To/)).toHaveValue('jobs@muster.example');
    expect(screen.getByLabelText('Message')).toHaveValue(draft().body);
    expect(screen.getByText(/Anschreiben_Max_Mustermann\.pdf/)).toBeInTheDocument();
    expect(screen.getByText('Together: 0.2 MB')).toBeInTheDocument();
    await user.clear(subject);
    await user.type(subject, 'Neuer Betreff');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    const post = f.mock.calls.find(([url]) => url === '/api/applications/app1/send');
    expect(JSON.parse(String(post![1]!.body))).toEqual({ to: 'jobs@muster.example', subject: 'Neuer Betreff', body: draft().body });
    expect(onSent.mock.calls[0]![1]).toBe('jobs@muster.example');
  });

  it('a failed send keeps the edited text, shows the error and offers "Try again"', async () => {
    const { user } = setup({ 'POST /api/applications/app1/send': () => ({ status: 502, body: { error: { code: 'MAIL_AUTH', detailsForLog: 'x' } } }) });
    const subject = await screen.findByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'Mein Betreff');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Your email provider did not accept the password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toHaveValue('Mein Betreff');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('while sending the button and the fields are off (no double click)', async () => {
    const { f, user } = setup();
    await screen.findByLabelText('Subject');
    f.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise<Response>(() => {});
      return new Response(JSON.stringify(draft()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.getByLabelText('Subject')).toBeDisabled();
    expect(f.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('the size warning shows above 4.8 MB', async () => {
    setup({}, draft({ totalSize: 5 * 1024 * 1024 }));
    expect(await screen.findByText(/more than 5 MB/)).toBeInTheDocument();
  });

  it('no size warning for a small package', async () => {
    setup();
    await screen.findByLabelText('Subject');
    expect(screen.queryByText(/more than 5 MB/)).not.toBeInTheDocument();
  });

  it('Send needs an address, a subject and a message', async () => {
    const { user } = setup({}, draft({ to: '' }));
    await screen.findByLabelText('Subject');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(screen.getByLabelText(/^To/), 'a@b.de');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('a mistyped address shows its own message and switches Send off; the text stays', async () => {
    const { f, user } = setup({}, draft({ to: '' }));
    const to = await screen.findByLabelText(/^To/);
    for (const bad of ['bewerbung@firma', 'a@b.de; c@d.de', 'max mustermann@example.com']) {
      await user.clear(to);
      await user.type(to, bad);
      expect(screen.getByText('Please check the address — it should look like name@company.de (one address only).')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    }
    expect(screen.getByLabelText('Message')).toHaveValue(draft().body);
    await user.clear(to);
    await user.type(to, 'jobs@muster.example');
    expect(screen.queryByText(/Please check the address/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(f.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('sent but not saved: a clear message and no "Try again"', async () => {
    const { user } = setup({ 'POST /api/applications/app1/send': () => ({ status: 409, body: { error: { code: 'CONFLICT', detailsForLog: 'x', reason: 'sentNotSaved' } } }) });
    await screen.findByLabelText('Subject');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const notice = await screen.findByText(/The email was sent, but the app could not save it\. Do not send it again/);
    expect(notice).toBeVisible();
    expect(notice.closest('details')).toBeNull();
    expect(screen.queryByText('This was changed in the meantime.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
});
