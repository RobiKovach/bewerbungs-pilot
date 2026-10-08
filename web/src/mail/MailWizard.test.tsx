import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MailWizard } from './MailWizard';
import { MailSettingsBlock } from './MailSettingsBlock';
import { mockFetch } from '../test/fetchMock';
import { profileWith, viewOf } from '../test/profileFixtures';
import type { MailProvider, MailSettingsView } from '../types';

const providers: MailProvider[] = [
  { id: 'gmail', label: 'Gmail', domains: ['gmail.com'], host: 'smtp.gmail.com', port: 465, security: 'ssl', helpUrl: 'https://myaccount.google.com/apppasswords' },
  { id: 'gmx', label: 'GMX', domains: ['gmx.de'], host: 'mail.gmx.net', port: 587, security: 'starttls', helpUrl: 'https://hilfe.gmx.net/' },
];
const none: MailSettingsView = { mail: null, passwordSaved: false };
const connected: MailSettingsView = {
  mail: { address: 'max@gmail.com', senderName: 'Max Mustermann', host: 'smtp.gmail.com', port: 465, security: 'ssl', user: 'max@gmail.com', provider: 'gmail' },
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
  it('detects Gmail and shows the Gmail instruction; unknown domain shows server fields', async () => {
    routes();
    const user = userEvent.setup();
    render(<MailWizard initial={none} onSaved={() => {}} />);
    const address = await screen.findByLabelText(/^Your email address/);
    await user.type(address, 'max@gmail.com');
    expect(await screen.findByText('Gmail detected')).toBeInTheDocument();
    expect(screen.queryByLabelText('Outgoing mail server (SMTP)')).toBeNull();
    await waitFor(() => expect(screen.getByLabelText(/^Your name as the sender/)).toHaveValue('Max Mustermann'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Open the "App passwords" page/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Gmail settings' })).toHaveAttribute('href', 'https://myaccount.google.com/apppasswords');
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
    await user.type(await screen.findByLabelText(/^Your email address/), 'max@gmail.com');
    await waitFor(() => expect(screen.getByLabelText(/^Your name as the sender/)).toHaveValue('Max Mustermann'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Password'), 'abcd efgh');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(putBodies(f)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Send a test email and save' }));
    expect(await screen.findByText('Done! Check your inbox for the test email.')).toBeInTheDocument();
    expect(putBodies(f)).toEqual([{
      address: 'max@gmail.com', senderName: 'Max Mustermann', host: 'smtp.gmail.com', port: 465, security: 'ssl',
      user: 'max@gmail.com', password: 'abcdefgh', language: 'en',
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
    await user.type(await screen.findByLabelText(/^Your email address/), 'max@gmail.com');
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
    render(<MailWizard initial={connected} onSaved={() => {}} />);
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
    render(<MailWizard initial={connected} onSaved={() => {}} />);
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
