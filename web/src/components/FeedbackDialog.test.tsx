import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { emptyProfile, viewOf } from '../test/profileFixtures';
import type { PersonalFinding } from '../types';
import { FeedbackDialog } from './FeedbackDialog';

const iban: PersonalFinding = { kind: 'iban', value: 'DE89370400440532013000', where: { part: 'email', field: 'body' } };

function routes(over: Record<string, RouteHandler> = {}, profileEmail = 'max@example.de') {
  const profile = emptyProfile();
  profile.sections.personal.data.email = profileEmail;
  return {
    'GET /api/health': () => ({ body: { ok: true, app: 'BewerbungsPilot', version: '0.11.0' } }),
    'GET /api/profile': () => ({ body: viewOf(profile) }),
    'POST /api/feedback/check-text': () => ({ body: { warnings: [] } }),
    // The fetch mock cannot build a 204; the app treats an empty answer and null alike.
    'POST /api/feedback': () => ({ body: null }),
    ...over,
  };
}

const EMAIL_LABEL = 'Your email (for our reply)';

describe('FeedbackDialog', () => {
  it('prefills the email from the profile, lets it be changed, and shows exactly what is sent (real version)', async () => {
    mockFetch(routes());
    render(<FeedbackDialog onClose={() => {}} />);
    const email = screen.getByLabelText(EMAIL_LABEL);
    await waitFor(() => expect(email).toHaveValue('max@example.de'));
    const user = userEvent.setup();
    await user.clear(email);
    await user.type(email, 'other@example.de');
    expect(email).toHaveValue('other@example.de');
    expect(await screen.findByText('Sent: your text, this address, app version 0.11.0. Nothing else from your data.')).toBeInTheDocument();
  });

  it('needs a text and a valid email before "Send" works', async () => {
    mockFetch(routes({}, ''));
    render(<FeedbackDialog onClose={() => {}} />);
    const user = userEvent.setup();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('Your message'), 'Something is wrong');
    expect(send).toBeDisabled(); // no email yet
    const email = screen.getByLabelText(EMAIL_LABEL);
    await user.type(email, 'a@b');
    expect(send).toBeDisabled();
    expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();
    await user.type(email, '.de');
    expect(send).toBeEnabled();
  });

  it('sends kind, trimmed email and text, then thanks the person', async () => {
    const f = mockFetch(routes());
    let closed = false;
    render(<FeedbackDialog onClose={() => { closed = true; }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Idea' }));
    await user.type(screen.getByLabelText('Your message'), 'Please add dark mode');
    await waitFor(() => expect(screen.getByLabelText(EMAIL_LABEL)).toHaveValue('max@example.de'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Thank you! Your message was sent.')).toBeInTheDocument();
    const call = f.mock.calls.find((c) => c[0] === '/api/feedback')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ kind: 'idea', email: 'max@example.de', text: 'Please add dark mode' });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(closed).toBe(true);
  });

  it('keeps the text and shows the error on a 502, and Send stays available', async () => {
    mockFetch(routes({ 'POST /api/feedback': () => ({ status: 502, body: { error: { code: 'FEEDBACK_FAILED', reason: 'offline', detailsForLog: '' } } }) }));
    render(<FeedbackDialog onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your message'), 'Hello');
    await waitFor(() => expect(screen.getByLabelText(EMAIL_LABEL)).toHaveValue('max@example.de'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Your message could not be sent.')).toBeInTheDocument();
    expect(screen.getByLabelText('Your message')).toHaveValue('Hello');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('shows the personal-data hint but never disables Send', async () => {
    mockFetch(routes({ 'POST /api/feedback/check-text': () => ({ body: { warnings: [iban] } }) }));
    render(<FeedbackDialog onClose={() => {}} />);
    await userEvent.setup().type(screen.getByLabelText('Your message'), 'my IBAN DE89370400440532013000');
    expect(await screen.findByText('There is personal data here that is not in your profile')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(EMAIL_LABEL)).toHaveValue('max@example.de'));
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('a failing personal-data check is silent', async () => {
    mockFetch(routes({ 'POST /api/feedback/check-text': () => ({ status: 500, body: { error: { code: 'INTERNAL', detailsForLog: '' } } }) }));
    render(<FeedbackDialog onClose={() => {}} />);
    await userEvent.setup().type(screen.getByLabelText('Your message'), 'hello');
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByText('There is personal data here that is not in your profile')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
