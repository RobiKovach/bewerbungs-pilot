import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { appView, jobState } from '../test/applicationFixtures';
import { ApplicationsPage } from '../pages/ApplicationsPage';
import type { ApplicationView } from '../types';

function setup(routes: Record<string, RouteHandler>, view: ApplicationView = appView()) {
  window.location.hash = '#/applications/app1';
  const f = mockFetch({
    'GET /api/applications/app1': () => ({ body: view }),
    'GET /api/applications/job': () => ({ body: jobState() }),
    ...routes,
  });
  render(<ApplicationsPage pollMs={10} />);
  return { f, user: userEvent.setup() };
}

describe('ApplicationEditor — letter', () => {
  it('shows the parts, the hint, and a sandboxed preview of the letter', async () => {
    setup({}, appView({}, { letter: { ...appView().application.letter, hint: 'Eine Geschichte über Kundenkontakt würde helfen.' } }));
    expect(await screen.findByRole('heading', { name: 'Muster GmbH — Webentwickler (m/w/d)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toHaveValue('Bewerbung als Webentwickler (m/w/d)');
    expect(screen.getByLabelText('Paragraph 2')).toHaveValue('Absatz zwei.');
    expect(screen.getByText(/Kundenkontakt würde helfen/)).toBeInTheDocument();
    const frame = screen.getByTitle('Preview of the letter');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('src')).toBe('/api/applications/app1/preview/letter?v=2026-09-29T10%3A00%3A00.000Z');
  });

  it('saves only the changed fields and shows the new server version', async () => {
    const saved = appView({}, { updatedAt: '2026-09-29T11:00:00.000Z', letter: { ...appView().application.letter, subject: 'Neuer Betreff' } });
    const { f, user } = setup({ 'PATCH /api/applications/app1/letter': () => ({ body: saved }) });
    const subject = await screen.findByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'Neuer Betreff');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const patch = f.mock.calls.find(([url, init]) => url === '/api/applications/app1/letter' && init?.method === 'PATCH');
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ subject: 'Neuer Betreff' });
    await waitFor(() => expect(screen.getByTitle('Preview of the letter').getAttribute('src')).toContain('11%3A00'));
  });

  it('a letter over one page shows a red mark and Approve is disabled', async () => {
    setup({}, appView({}, { letter: { ...appView().application.letter, pages: 2 } }));
    expect(await screen.findByText('The letter is longer than one page (2 pages). Please shorten it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('a stored page count other than 1 is counted again on opening (it may be stale after an update)', async () => {
    const { f } = setup({
      'POST /api/applications/app1/recount': () => ({ body: appView({}, { letter: { ...appView().application.letter, pages: 1 } }) }),
    }, appView({}, { letter: { ...appView().application.letter, pages: 2 } }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
    expect(screen.queryByText(/longer than one page/)).not.toBeInTheDocument();
    expect(f.mock.calls.some(([url]) => url === '/api/applications/app1/recount')).toBe(true);
  });

  it('a letter not counted yet (pages 0) can be approved; LETTER_TOO_LONG from the server is shown', async () => {
    const { user } = setup({
      'POST /api/applications/app1/approve': () => ({ status: 409, body: { error: { code: 'LETTER_TOO_LONG', detailsForLog: '2 pages' } } }),
    }, appView({}, { letter: { ...appView().application.letter, pages: 0 } }));
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('The cover letter is longer than one page.')).toBeInTheDocument();
  });

  it('approve → Approved and "Back to draft"', async () => {
    const { user } = setup({
      'POST /api/applications/app1/approve': () => ({ body: appView({}, { status: 'approved', approvedAt: '2026-09-29T12:00:00.000Z', updatedAt: '2026-09-29T12:00:00.000Z' }) }),
    });
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to draft' })).toBeInTheDocument();
  });

  it('"Ask Claude" starts a revise job, locks editing while it runs and reloads when done', async () => {
    let jobCalls = 0;
    let loads = 0;
    const { f, user } = setup({
      'GET /api/applications/app1': () => ({ body: loads++ === 0 ? appView() : appView({}, { updatedAt: '2026-09-29T13:00:00.000Z', letter: { ...appView().application.letter, paragraphs: ['Neu eins.', 'Neu zwei.', 'Neu drei.'] } }) }),
      'POST /api/applications/app1/revise': () => ({ status: 202, body: jobState({ state: 'running', kind: 'revise', applicationId: 'app1', vacancyId: 'v1' }) }),
      'GET /api/applications/job': () => ({ body: jobCalls++ < 2 ? (jobCalls === 1 ? jobState() : jobState({ state: 'running', kind: 'revise', applicationId: 'app1' })) : jobState({ state: 'done', kind: 'revise', applicationId: 'app1' }) }),
    });
    await user.type(await screen.findByLabelText('Ask Claude to change the letter'), 'Bitte kürzer');
    await user.click(screen.getByRole('button', { name: 'Ask Claude' }));
    const post = f.mock.calls.find(([url]) => url === '/api/applications/app1/revise');
    expect(JSON.parse(String(post![1]!.body))).toEqual({ instruction: 'Bitte kürzer' });
    expect(await screen.findByText(/Claude is changing the letter/)).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Neu zwei.')).toBeInTheDocument();
  });

  it('Claude buttons are off while a job for ANOTHER package runs; editing stays possible', async () => {
    const { user } = setup({
      'GET /api/applications/job': () => ({ body: jobState({ state: 'running', kind: 'create', applicationId: 'other', vacancyId: 'v2' }) }),
    });
    await user.type(await screen.findByLabelText('Ask Claude to change the letter'), 'Bitte kürzer');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ask Claude' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Create again' })).toBeDisabled();
    expect(screen.getByLabelText('Subject')).toBeEnabled();
  });

  it('delete asks inside the page, then deletes and returns to the list', async () => {
    const { user } = setup({
      'DELETE /api/applications/app1': () => ({ body: { ok: true } }),
      'GET /api/applications': () => ({ body: { applications: [] } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Delete package' }));
    const confirm = screen.getByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(window.location.hash).toBe('#/applications'));
  });

  it('create again asks for the language and starts a recreate job', async () => {
    const { f, user } = setup({ 'POST /api/applications/app1/recreate': () => ({ status: 202, body: jobState({ state: 'running', kind: 'recreate', applicationId: 'app1' }) }) });
    await user.click(await screen.findByRole('button', { name: 'Create again' }));
    const confirm = screen.getByRole('alertdialog');
    await user.click(within(confirm).getByRole('radio', { name: 'English' }));
    await user.click(within(confirm).getByRole('button', { name: 'Yes, create again' }));
    const post = f.mock.calls.find(([url]) => url === '/api/applications/app1/recreate');
    expect(JSON.parse(String(post![1]!.body))).toEqual({ language: 'en' });
  });

  it('unsaved edits switch Approve off until saved or discarded', async () => {
    const saved = appView({}, { updatedAt: '2026-09-29T11:00:00.000Z', letter: { ...appView().application.letter, subject: 'Neuer Betreff' } });
    const { user } = setup({ 'PATCH /api/applications/app1/letter': () => ({ body: saved }) });
    const subject = await screen.findByLabelText('Subject');
    await user.type(subject, 'X');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    await user.type(screen.getByLabelText('Subject'), 'Y');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
  });

  it('unsaved edits switch Back to draft off on an approved package', async () => {
    const { user } = setup({}, appView({}, { status: 'approved', approvedAt: '2026-09-29T12:00:00.000Z' }));
    await user.type(await screen.findByLabelText('Subject'), 'X');
    expect(screen.getByRole('button', { name: 'Back to draft' })).toBeDisabled();
  });

  it('a job for ANOTHER package shows the plain "busy" text without a Cancel button', async () => {
    setup({
      'GET /api/applications/job': () => ({ body: jobState({ state: 'running', kind: 'revise', applicationId: 'other', vacancyId: 'v2' }) }),
    });
    expect(await screen.findByText('Claude is working on another package. Please wait a moment.')).toBeInTheDocument();
    expect(screen.queryByText(/Claude is changing the letter/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('a failed reload after a job shows the error and keeps editing off until a reload succeeds', async () => {
    let loads = 0;
    let jobCalls = 0;
    const { user } = setup({
      'GET /api/applications/app1': () => {
        loads += 1;
        if (loads === 1) return { body: appView() };
        if (loads === 2) return { status: 500, body: { error: { code: 'INTERNAL', detailsForLog: 'boom' } } };
        return { body: appView({}, { updatedAt: '2026-09-29T13:00:00.000Z', letter: { ...appView().application.letter, subject: 'Von Claude' } }) };
      },
      'POST /api/applications/app1/revise': () => ({ status: 202, body: jobState({ state: 'running', kind: 'revise', applicationId: 'app1', vacancyId: 'v1' }) }),
      'GET /api/applications/job': () => {
        jobCalls += 1;
        return { body: jobCalls <= 1 ? jobState() : jobState({ state: 'done', kind: 'revise', applicationId: 'app1' }) };
      },
    });
    await user.type(await screen.findByLabelText('Ask Claude to change the letter'), 'Bitte kürzer');
    await user.click(screen.getByRole('button', { name: 'Ask Claude' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toBeEnabled());
    expect(screen.getByLabelText('Subject')).toHaveValue('Von Claude');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('downloads wait while there are unsaved edits (they use the saved state)', async () => {
    const { user } = setup({});
    await user.type(await screen.findByLabelText('Subject'), 'X');
    expect(screen.getByRole('button', { name: 'Cover letter (PDF)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'CV (PDF)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Everything as one PDF' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('button', { name: 'Everything as one PDF' })).toBeEnabled();
  });

  it('LETTER_TOO_LONG from approve reloads the package so the red page mark shows', async () => {
    let loads = 0;
    const { user } = setup({
      'GET /api/applications/app1': () => ({ body: loads++ === 0 ? appView({}, { letter: { ...appView().application.letter, pages: 1 } }) : appView({}, { letter: { ...appView().application.letter, pages: 2 } }) }),
      'POST /api/applications/app1/approve': () => ({ status: 409, body: { error: { code: 'LETTER_TOO_LONG', detailsForLog: '2 pages' } } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('The letter is longer than one page (2 pages). Please shorten it.')).toBeInTheDocument();
  });
});

describe('ApplicationEditor — sending and the frozen package', () => {
  const mail = { 'GET /api/mail/settings': () => ({ body: { mail: { provider: 'gmail', address: 'max@example.com', senderName: 'Max Mustermann', host: 'smtp.gmail.com', port: 465, security: 'ssl' }, passwordSaved: true } }) };
  const approved = () => appView({}, { status: 'approved', approvedAt: '2026-09-29T12:00:00.000Z' });
  const sentView = () => appView({}, {
    status: 'sent', sentAt: '2026-09-30T08:00:00.000Z',
    sentEmail: { to: 'jobs@muster.example', subject: 'Mein Betreff', body: 'Gesendeter Text', attachments: ['Anschreiben_Max_Mustermann.pdf'] },
  });

  it('Send is off with a reason when the email is not connected', async () => {
    setup({ 'GET /api/mail/settings': () => ({ body: { mail: null, passwordSaved: false } }) }, approved());
    expect(await screen.findByText('To send applications, please connect your email first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Connect your email' })).toHaveAttribute('href', '#/settings');
  });

  it('a draft has no Send button', async () => {
    setup(mail);
    await screen.findByRole('button', { name: 'Approve' });
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('Send opens the dialog; after sending the package is read-only with a green notice', async () => {
    const { user } = setup({
      ...mail,
      'GET /api/applications/app1/send-draft': () => ({ body: { to: 'jobs@muster.example', subject: 'S', body: 'B', attachments: [], totalSize: 1000, mailReady: true } }),
      'POST /api/applications/app1/send': () => ({ body: sentView() }),
    }, approved());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Send' })).toBeEnabled());
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Sent to jobs@muster.example — a copy is in your mailbox.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Sent', { selector: '.badge' })).toBeInTheDocument();
  });

  it('unsaved edits switch Send off', async () => {
    const { user } = setup(mail, approved());
    await user.type(await screen.findByLabelText('Subject'), 'X');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('a sent package is read-only: no Approve, no Ask Claude, no Update CV; downloads work', async () => {
    const { f, user } = setup(mail, appView({ profileChanged: true }, sentView().application));
    expect(await screen.findByText('This application was sent — it can no longer be changed. Downloads still work.')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toBeDisabled();
    for (const name of ['Approve', 'Back to draft', 'Create again', 'Ask Claude', 'Save changes', 'Send']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Delete package' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cover letter (PDF)' })).toBeEnabled();
    await user.click(screen.getByRole('tab', { name: 'CV' }));
    expect(screen.queryByRole('button', { name: 'Update CV' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Job title under your name')).toBeDisabled();
    expect(f.mock.calls.some(([url]) => String(url).endsWith('/recount'))).toBe(false);
  });

  it('does not recount the pages of a sent package', async () => {
    const { f } = setup(mail, appView({}, { ...sentView().application, letter: { ...appView().application.letter, pages: 0 } }));
    await screen.findByText(/no longer be changed/);
    expect(f.mock.calls.some(([url]) => String(url).endsWith('/recount'))).toBe(false);
  });

  it('"What was sent" shows the stored email', async () => {
    const { user } = setup(mail, sentView());
    await user.click(await screen.findByText('What was sent'));
    expect(screen.getByText('jobs@muster.example')).toBeInTheDocument();
    expect(screen.getByText('Mein Betreff')).toBeInTheDocument();
    expect(screen.getByText('Gesendeter Text')).toBeInTheDocument();
    expect(screen.getByText('Anschreiben_Max_Mustermann.pdf')).toBeInTheDocument();
  });

  it('a 409 without a reason (a status route) still shows a sensible message', async () => {
    const { user } = setup({
      ...mail,
      'POST /api/applications/app1/unapprove': () => ({ status: 409, body: { error: { code: 'CONFLICT', detailsForLog: 'x' } } }),
    }, approved());
    await user.click(await screen.findByRole('button', { name: 'Back to draft' }));
    expect(await screen.findByText('This was changed in the meantime.')).toBeInTheDocument();
  });

  it('connected but the password must be entered again: Send is off and says so', async () => {
    setup({ 'GET /api/mail/settings': () => ({ body: { ...mail['GET /api/mail/settings']().body, passwordSaved: false } }) }, approved());
    expect(await screen.findByText('Your email password needs to be entered again before you can send.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Enter the password again' })).toHaveAttribute('href', '#/settings');
    expect(screen.queryByText('To send applications, please connect your email first.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('the send window closes when the package goes back to draft behind it', async () => {
    const { user } = setup({
      ...mail,
      'GET /api/applications/app1/send-draft': () => ({ body: { to: 'jobs@muster.example', subject: 'S', body: 'B', attachments: [], totalSize: 1000, mailReady: true } }),
      'POST /api/applications/app1/unapprove': () => ({ body: appView({}, { updatedAt: '2026-09-29T14:00:00.000Z' }) }),
    }, approved());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to draft' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('"Copy as a new draft" on a sent package opens the new draft', async () => {
    const { f, user } = setup({
      ...mail,
      'POST /api/applications/app1/copy': () => ({ body: appView({}, { id: 'app2' }) }),
    }, sentView());
    await user.click(await screen.findByRole('button', { name: 'Copy as a new draft' }));
    await waitFor(() => expect(window.location.hash).toBe('#/applications/app2'));
    expect(f.mock.calls.some(([url, init]) => url === '/api/applications/app1/copy' && init?.method === 'POST')).toBe(true);
  });

  it('a refused copy shows why (another package of this offer is not sent yet)', async () => {
    const { user } = setup({
      ...mail,
      'POST /api/applications/app1/copy': () => ({ status: 409, body: { error: { code: 'CONFLICT', detailsForLog: 'x', reason: 'draftExists', params: { id: 'app2' } } } }),
    }, sentView());
    await user.click(await screen.findByRole('button', { name: 'Copy as a new draft' }));
    expect(await screen.findByText(/already has a package that was not sent yet/)).toBeInTheDocument();
    expect(window.location.hash).toBe('#/applications/app1');
  });
});

describe('ApplicationEditor — statuses', () => {
  const mail = { 'GET /api/mail/settings': () => ({ body: { mail: null, passwordSaved: false } }) };
  const approved = () => appView({}, { status: 'approved', approvedAt: '2026-09-29T12:00:00.000Z' });
  const sent = (over: Partial<ApplicationView> = {}) => appView(over, {
    status: 'sent', sentAt: '2026-09-30T08:00:00.000Z', history: [{ kind: 'sent', at: '2026-09-30T08:00:00.000Z', to: 'jobs@muster.example' }],
    sentEmail: { to: 'jobs@muster.example', subject: 'S', body: 'B', attachments: [] },
  });

  it('"I applied myself" asks first and marks the package submitted', async () => {
    const { f, user } = setup({
      ...mail,
      'POST /api/applications/app1/submitted': () => ({ body: appView({}, { status: 'submitted', history: [{ kind: 'submitted', at: '2026-10-08T08:00:00.000Z' }] }) }),
    }, approved());
    await user.click(await screen.findByRole('button', { name: "I applied myself on the company's website" }));
    expect(screen.getByText('Mark as submitted? The package can then no longer be changed.')).toBeInTheDocument();
    expect(f.mock.calls.some(([url]) => url === '/api/applications/app1/submitted')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, mark as submitted' }));
    expect(await screen.findByText('Submitted on the website', { selector: '.app-row__meta .badge.status-submitted' })).toBeInTheDocument();
    expect(f.mock.calls.some(([url, init]) => url === '/api/applications/app1/submitted' && init?.method === 'POST')).toBe(true);
    expect(screen.queryByRole('button', { name: "I applied myself on the company's website" })).not.toBeInTheDocument();
  });

  it('change status sends status, date and note', async () => {
    const after = appView({ canUndo: true }, { status: 'interview', history: [{ kind: 'sent', at: '2026-09-30T08:00:00.000Z' }, { kind: 'interview', at: '2026-10-08T00:00:00.000Z', note: 'Montag' }] });
    const { f, user } = setup({ ...mail, 'POST /api/applications/app1/status': () => ({ body: after }) }, sent());
    await user.click(await screen.findByRole('button', { name: 'Change status' }));
    const dialog = screen.getByRole('dialog', { name: 'Change status' });
    await user.click(within(dialog).getByRole('radio', { name: 'Offer' }));
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-10-08' } });
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Montag');
    expect(within(dialog).getByText('6 / 300')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = f.mock.calls.find(([url]) => url === '/api/applications/app1/status');
    expect(JSON.parse(String(post![1]!.body))).toEqual({ status: 'offer', date: '2026-10-08', note: 'Montag' });
    expect(await screen.findByRole('button', { name: 'Undo last change' })).toBeInTheDocument();
  });

  it('undo asks first, then calls the server', async () => {
    const { f, user } = setup({ ...mail, 'POST /api/applications/app1/status/undo': () => ({ body: sent() }) }, sent({ canUndo: true }));
    await user.click(await screen.findByRole('button', { name: 'Undo last change' }));
    expect(f.mock.calls.some(([url]) => url === '/api/applications/app1/status/undo')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, undo' }));
    await waitFor(() => expect(f.mock.calls.some(([url, init]) => url === '/api/applications/app1/status/undo' && init?.method === 'POST')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo last change' })).not.toBeInTheDocument());
  });
});

describe('ApplicationEditor — status dialog safety', () => {
  const mail = { 'GET /api/mail/settings': () => ({ body: { mail: null, passwordSaved: false } }) };
  const sentV = () => appView({}, { status: 'sent', sentAt: '2026-09-30T08:00:00.000Z', history: [{ kind: 'sent', at: '2026-09-30T08:00:00.000Z' }], sentEmail: { to: 'a@b.de', subject: 'S', body: 'B', attachments: [] } });

  it('a refused save keeps the dialog open with the typed note and shows the error', async () => {
    const { user } = setup({ ...mail, 'POST /api/applications/app1/status': () => ({ status: 409, body: { error: { code: 'CONFLICT', detailsForLog: 'x' } } }) }, sentV());
    await user.click(await screen.findByRole('button', { name: 'Change status' }));
    const dialog = screen.getByRole('dialog', { name: 'Change status' });
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Meine Notiz');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Change status' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Note (optional)')).toHaveValue('Meine Notiz');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('a date more than a year ahead switches Save off; the note stops at 300 characters', async () => {
    const { user } = setup(mail, sentV());
    await user.click(await screen.findByRole('button', { name: 'Change status' }));
    const dialog = screen.getByRole('dialog', { name: 'Change status' });
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2099-01-01' } });
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(within(dialog).getByLabelText('Note (optional)')).toHaveAttribute('maxlength', '300');
  });
});
