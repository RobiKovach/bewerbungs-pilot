import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MailWizard } from './MailWizard';
import { MailSettingsBlock } from './MailSettingsBlock';
import { mockFetch } from '../test/fetchMock';
import { profileWith, viewOf } from '../test/profileFixtures';
import type { GoogleSignInStatus, MailProvider, MailSettingsView } from '../types';

const providers: MailProvider[] = [
  { id: 'gmail', label: 'Gmail', domains: ['gmail.com'], host: 'smtp.gmail.com', port: 465, security: 'ssl', helpUrl: 'https://myaccount.google.com/apppasswords' },
  { id: 'gmx', label: 'GMX', domains: ['gmx.de'], host: 'mail.gmx.net', port: 587, security: 'starttls', helpUrl: 'https://hilfe.gmx.net/' },
];
const none: MailSettingsView = { mail: null, passwordSaved: false };
const connected: MailSettingsView = {
  mail: { kind: 'smtp', address: 'max@gmail.com', senderName: 'Max Mustermann', host: 'smtp.gmail.com', port: 465, security: 'ssl', user: 'max@gmail.com', provider: 'gmail' },
  passwordSaved: true,
};
const connectedGmx: MailSettingsView = {
  mail: { kind: 'smtp', address: 'max@gmx.de', senderName: 'Max Mustermann', host: 'mail.gmx.net', port: 587, security: 'starttls', user: 'max@gmx.de', provider: 'gmx' },
  passwordSaved: true,
};
const connectedGoogle: MailSettingsView = {
  mail: { kind: 'google', address: 'max@gmail.com', senderName: 'Max Mustermann', provider: 'gmail' },
  passwordSaved: true,
};

function routes(extra: Parameters<typeof mockFetch>[0] = {}, opts: Parameters<typeof mockFetch>[1] = {}) {
  return mockFetch({
    'GET /api/mail/providers': () => ({ body: providers }),
    'GET /api/profile': () => ({ body: viewOf(profileWith((p) => { p.sections.personal.data.fullName = 'Max Mustermann'; })) }),
    ...extra,
  }, opts);
}
const putBodies = (f: ReturnType<typeof mockFetch>) =>
  f.mock.calls
    .filter((x) => (x[1] as RequestInit | undefined)?.method === 'PUT')
    .map((x) => JSON.parse(String((x[1] as RequestInit).body)) as Record<string, unknown>);

describe('MailWizard', () => {
  it('detects a provider and shows its instruction; unknown domain shows server fields', async () => {
    routes();
    const user = userEvent.setup();
    render(<MailWizard initial={none} onSaved={() => {}} />);
    const address = await screen.findByLabelText(/^Your email address/);
    await user.type(address, 'max@gmx.de');
    expect(await screen.findByText('GMX detected')).toBeInTheDocument();
    expect(screen.queryByLabelText('Outgoing mail server (SMTP)')).toBeNull();
    await waitFor(() => expect(screen.getByLabelText(/^Your name as the sender/)).toHaveValue('Max Mustermann'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Log in to your GMX mailbox/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open GMX settings' })).toHaveAttribute('href', 'https://hilfe.gmx.net/');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const again = screen.getByLabelText(/^Your email address/);
    await user.clear(again);
    await user.type(again, 'max@example.com');
    expect(await screen.findByLabelText('Outgoing mail server (SMTP)')).toBeInTheDocument();
    expect(screen.getByLabelText('User name')).toHaveValue('max@example.com');
    expect(screen.getByLabelText('SSL/TLS (port 465)')).toBeChecked();
  });

  it('saves only through "Send a test email and save" and shows the result', async () => {
    const f = routes({ 'PUT /api/mail/settings': () => ({ body: connected }) });
    const user = userEvent.setup();
    const calls: MailSettingsView[] = [];
    render(<MailWizard initial={none} onSaved={(v) => calls.push(v)} />);
    await user.type(await screen.findByLabelText(/^Your email address/), 'max@gmx.de');
    await waitFor(() => expect(screen.getByLabelText(/^Your name as the sender/)).toHaveValue('Max Mustermann'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Password'), 'abcd efgh');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(putBodies(f)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Send a test email and save' }));
    expect(await screen.findByText('Done! Check your inbox for the test email.')).toBeInTheDocument();
    expect(putBodies(f)).toEqual([{
      address: 'max@gmx.de', senderName: 'Max Mustermann', host: 'mail.gmx.net', port: 587, security: 'starttls',
      user: 'max@gmx.de', password: 'abcd efgh', language: 'en',
    }]);
    expect(calls).toEqual([connected]);
  });

  it('sends the password verbatim (spaces kept) for an own server', async () => {
    const f = routes({ 'PUT /api/mail/settings': () => ({ body: connected }) });
    const user = userEvent.setup();
    render(<MailWizard initial={none} onSaved={() => {}} />);
    await user.type(await screen.findByLabelText(/^Your email address/), 'max@example.com');
    await user.type(screen.getByLabelText(/^Your name as the sender/), 'Max');
    await user.type(await screen.findByLabelText('Outgoing mail server (SMTP)'), 'mail.example.com');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Password'), 'ab cd');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Send a test email and save' }));
    await screen.findByText('Done! Check your inbox for the test email.');
    expect(putBodies(f)[0]).toMatchObject({ host: 'mail.example.com', password: 'ab cd' });
  });

  it('a known provider other than Gmail (GMX) also gets the password verbatim', async () => {
    const f = routes({ 'PUT /api/mail/settings': () => ({ body: connected }) });
    const user = userEvent.setup();
    render(<MailWizard initial={none} onSaved={() => {}} />);
    await user.type(await screen.findByLabelText(/^Your email address/), 'max@gmx.de');
    expect(await screen.findByText('GMX detected')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^Your name as the sender/)).toHaveValue('Max Mustermann'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Password'), 'mein Passwort 1');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Send a test email and save' }));
    await screen.findByText('Done! Check your inbox for the test email.');
    expect(putBodies(f)[0]).toMatchObject({ host: 'mail.gmx.net', password: 'mein Passwort 1' });
  });

  it('a failed test shows the error and keeps the entered values', async () => {
    routes({ 'PUT /api/mail/settings': () => ({ status: 401, body: { error: { code: 'MAIL_AUTH', detailsForLog: '' } } }) });
    const user = userEvent.setup();
    render(<MailWizard initial={none} onSaved={() => {}} />);
    await user.type(await screen.findByLabelText(/^Your email address/), 'max@gmx.de');
    await user.type(screen.getByLabelText(/^Your name as the sender/), 'Max');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Send a test email and save' }));
    expect(await screen.findByText('Your email provider did not accept the password.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a test email and save' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Password')).toHaveValue('secret');
  });

  it('editing with a saved password: empty password field sends no password', async () => {
    const f = routes({ 'PUT /api/mail/settings': () => ({ body: connected }) });
    const user = userEvent.setup();
    render(<MailWizard initial={connectedGmx} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByPlaceholderText('Saved — leave empty to keep it')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Send a test email and save' }));
    await screen.findByText('Done! Check your inbox for the test email.');
    expect(putBodies(f)[0]).not.toHaveProperty('password');
  });

  it('disables the send button while the test email is being sent', async () => {
    routes({}, { pending: ['PUT /api/mail/settings'] });
    const user = userEvent.setup();
    render(<MailWizard initial={connectedGmx} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Send a test email and save' }));
    expect(await screen.findByText('Sending a test email…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a test email and save' })).toBeDisabled();
  });
});

describe('MailSettingsBlock', () => {
  it('disconnect asks first, then calls disconnectMail', async () => {
    let called = 0;
    routes({
      'GET /api/mail/settings': () => ({ body: connected }),
      'DELETE /api/mail/settings': () => { called++; return { body: none }; },
    });
    const user = userEvent.setup();
    render(<MailSettingsBlock />);
    expect(await screen.findByText('Connected: max@gmail.com')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Provider: Gmail')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByText('Disconnect your email? The saved password is deleted.')).toBeInTheDocument();
    expect(called).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }));
    expect(await screen.findByRole('button', { name: 'Connect your email' })).toBeInTheDocument();
    expect(called).toBe(1);
  });

  it('connected but the password cannot be read here: asks to enter it again, "Change" opens the wizard', async () => {
    routes({ 'GET /api/mail/settings': () => ({ body: { ...connected, passwordSaved: false } }) });
    const user = userEvent.setup();
    render(<MailSettingsBlock />);
    expect(await screen.findByText(/Your password needs to be entered again/)).toBeInTheDocument();
    expect(screen.queryByText('Connected: max@gmail.com')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(await screen.findByLabelText(/^Your email address/)).toHaveValue('max@gmail.com');
  });

  it('cancelling the confirmation keeps the email connected', async () => {
    let called = 0;
    routes({
      'GET /api/mail/settings': () => ({ body: connected }),
      'DELETE /api/mail/settings': () => { called++; return { body: none }; },
    });
    const user = userEvent.setup();
    render(<MailSettingsBlock />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(called).toBe(0);
  });
});

describe('MailWizard with Google', () => {
  afterEach(() => vi.restoreAllMocks());

  const URL = 'https://accounts.google.com/o/oauth2/v2/auth?x=1';

  /** Scripted status answers; the last one repeats. */
  function google(statuses: GoogleSignInStatus[], save: () => { status?: number; body: unknown } = () => ({ body: connectedGoogle })) {
    let n = 0;
    const calls = { start: [] as unknown[], save: [] as unknown[], status: 0 };
    routes({
      'POST /api/mail/google/start': (init) => { calls.start.push(JSON.parse(String(init?.body))); return { body: { url: URL } }; },
      'GET /api/mail/google/status': () => { calls.status++; return { body: statuses[Math.min(n++, statuses.length - 1)] }; },
      'POST /api/mail/google/save': (init) => { calls.save.push(JSON.parse(String(init?.body))); return save(); },
    });
    return { calls };
  }

  async function toStep2(onSaved: (v: MailSettingsView) => void = () => {}) {
    const user = userEvent.setup();
    render(<MailWizard initial={none} onSaved={onSaved} pollMs={10} />);
    await user.type(await screen.findByLabelText(/^Your email address/), 'max@gmail.com');
    await waitFor(() => expect(screen.getByLabelText(/^Your name as the sender/)).toHaveValue('Max Mustermann'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    return user;
  }

  it('Gmail: step 2 of 2 explains send-only access and the unverified-app screen; no password field', async () => {
    google([{ state: 'idle' }]);
    await toStep2();
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByText(/only gets permission to send emails/)).toBeInTheDocument();
    expect(screen.getByText(/"Advanced", then "Go to BewerbungsPilot"/)).toBeInTheDocument();
    expect(screen.getByText(/tick "Send email on your behalf"/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('sign-in failed with MAIL_SCOPE (box left unticked): says what to do, "Try again" signs in again', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { calls } = google([{ state: 'failed', code: 'MAIL_SCOPE' }]);
    const user = await toStep2();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText('You did not allow BewerbungsPilot to send emails.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls.start).toHaveLength(2));
  });

  it('save fails with MAIL_SCOPE: "Try again" starts a new sign-in instead of saving the same key again', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { calls } = google([{ state: 'ready', email: 'max@gmail.com' }], () => ({ status: 409, body: { error: { code: 'MAIL_SCOPE', detailsForLog: '' } } }));
    const user = await toStep2();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText('You did not allow BewerbungsPilot to send emails.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls.start).toHaveLength(2));
    expect(calls.save.length).toBeGreaterThanOrEqual(1);
  });

  it('starts sign-in, opens the page, then saves once Google says ready', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { calls } = google([{ state: 'pending' }, { state: 'ready', email: 'max@gmail.com' }]);
    const saved: MailSettingsView[] = [];
    const user = await toStep2((v) => saved.push(v));
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText('Your email is connected.')).toBeInTheDocument();
    expect(calls.start).toEqual([{ address: 'max@gmail.com' }]);
    expect(open).toHaveBeenCalledWith(URL, '_blank', 'noopener,noreferrer');
    expect(calls.save).toEqual([{ senderName: 'Max Mustermann', language: 'en' }]);
    expect(saved).toEqual([connectedGoogle]);
    expect(screen.queryByText(/You signed in as/)).toBeNull();
  });

  it('shows a fallback link while waiting', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    google([{ state: 'pending' }]);
    const user = await toStep2();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByRole('link', { name: 'Open the Google sign-in page' })).toHaveAttribute('href', URL);
    expect(screen.getByText(/Waiting for you to finish/)).toBeInTheDocument();
  });

  it('notes a different Google address and still saves', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { calls } = google([{ state: 'ready', email: 'other@gmail.com' }]);
    const user = await toStep2();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText('You signed in as other@gmail.com — the app will send from this address.')).toBeInTheDocument();
    await waitFor(() => expect(calls.save).toHaveLength(1));
  });

  it('cancelled: says so and "Try again" starts again', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { calls } = google([{ state: 'cancelled' }]);
    const user = await toStep2();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText('Sign-in with Google was cancelled.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls.start).toHaveLength(2));
  });

  it('failed (MAIL_CONNECT): shows the translated banner and "Try again" starts again', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { calls } = google([{ state: 'failed', code: 'MAIL_CONNECT' }]);
    const user = await toStep2();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText('We could not reach your email server.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls.start).toHaveLength(2));
  });

  it('save fails with MAIL_REAUTH: banner, "Try again" saves again without a new sign-in', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    let n = 0;
    const { calls } = google([{ state: 'ready', email: 'max@gmail.com' }], () => (
      n++ === 0 ? { status: 401, body: { error: { code: 'MAIL_REAUTH', detailsForLog: '' } } } : { body: connectedGoogle }
    ));
    const user = await toStep2();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText('Google no longer lets BewerbungsPilot send emails for you.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Your email is connected.')).toBeInTheDocument();
    expect(calls.save).toHaveLength(2);
    expect(calls.start).toHaveLength(1);
  });

  it('one lost status answer does not end the sign-in; the next answer still saves', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    let n = 0;
    const calls = { save: 0 };
    routes({
      'POST /api/mail/google/start': () => ({ body: { url: URL } }),
      'GET /api/mail/google/status': () => (n++ === 0 ? { status: 503, body: { error: { code: 'UNKNOWN', detailsForLog: 'x' } } } : { body: { state: 'ready', email: 'max@gmail.com' } }),
      'POST /api/mail/google/save': () => { calls.save++; return { body: connectedGoogle }; },
    });
    const user = await toStep2();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText('Your email is connected.')).toBeInTheDocument();
    expect(calls.save).toBe(1);
  });

  it('status answers keep failing: after a few in a row the step shows the failure and "Try again"', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    routes({
      'POST /api/mail/google/start': () => ({ body: { url: URL } }),
      'GET /api/mail/google/status': () => ({ status: 503, body: { error: { code: 'MAIL_CONNECT', detailsForLog: 'x' } } }),
    });
    const user = await toStep2();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('stops polling after unmount', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { calls } = google([{ state: 'pending' }]);
    const user = userEvent.setup();
    const { unmount } = render(<MailWizard initial={none} onSaved={() => {}} pollMs={10} />);
    await user.type(await screen.findByLabelText(/^Your email address/), 'max@gmail.com');
    await user.type(screen.getByLabelText(/^Your name as the sender/), 'Max');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() => expect(calls.status).toBeGreaterThan(1));
    unmount();
    const after = calls.status;
    await new Promise((r) => setTimeout(r, 60));
    expect(calls.status).toBe(after);
  });

  it('a non-Gmail address keeps the password path (3 steps)', async () => {
    google([{ state: 'idle' }]);
    const user = userEvent.setup();
    render(<MailWizard initial={none} onSaved={() => {}} />);
    await user.type(await screen.findByLabelText(/^Your email address/), 'max@gmx.de');
    await user.type(screen.getByLabelText(/^Your name as the sender/), 'Max');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('changing from Google to a non-Gmail address needs a new password (the Google key is not offered as one)', async () => {
    google([{ state: 'idle' }]);
    const user = userEvent.setup();
    render(<MailWizard initial={connectedGoogle} onSaved={() => {}} />);
    const address = await screen.findByLabelText(/^Your email address/);
    await user.clear(address);
    await user.type(address, 'max@gmx.de');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const pw = screen.getByLabelText('Password');
    expect(pw).not.toHaveAttribute('placeholder', 'Saved — leave empty to keep it');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.type(pw, 'geheim');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});

describe('MailSettingsBlock with Google', () => {
  it('shows "Connected with Google" when connected', async () => {
    routes({ 'GET /api/mail/settings': () => ({ body: connectedGoogle }) });
    render(<MailSettingsBlock />);
    expect(await screen.findByText('Connected with Google: max@gmail.com')).toBeInTheDocument();
  });

  it('asks to sign in again when the key is not readable; "Change" opens the wizard', async () => {
    routes({ 'GET /api/mail/settings': () => ({ body: { ...connectedGoogle, passwordSaved: false } }) });
    const user = userEvent.setup();
    render(<MailSettingsBlock />);
    expect(await screen.findByText('Sign in with Google again to send emails.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(await screen.findByLabelText(/^Your email address/)).toHaveValue('max@gmail.com');
  });
});
