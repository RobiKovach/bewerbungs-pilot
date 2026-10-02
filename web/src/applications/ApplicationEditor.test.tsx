import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
