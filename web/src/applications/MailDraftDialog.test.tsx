import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../api';
import { appView } from '../test/applicationFixtures';
import type { ApplicationView, MailDraft } from '../types';
import { MailDraftDialog } from './MailDraftDialog';

const draft = (over: Partial<MailDraft> = {}): MailDraft => ({ to: 'jobs@muster.example', subject: 'Nachfrage zu meiner Bewerbung', body: 'Sehr geehrte Damen und Herren,\n\nich frage kurz nach.', mailReady: true, ...over });

function setup(over: { d?: MailDraft; send?: () => Promise<ApplicationView>; afterCopy?: boolean } = {}) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  const send = vi.fn(over.send ?? (() => Promise.resolve(appView())));
  const run = vi.fn(() => Promise.resolve(appView()));
  render(
    <MailDraftDialog title="Reminder" load={() => Promise.resolve(over.d ?? draft())} send={send} onDone={onDone} onClose={onClose}
      afterCopy={over.afterCopy === false ? undefined : { label: 'Mark as reminded', run }} />,
  );
  return { onDone, onClose, send, run, user: userEvent.setup() };
}

describe('MailDraftDialog', () => {
  it('is prefilled and sends what the person edited', async () => {
    const { send, onDone, user } = setup();
    const subject = await screen.findByLabelText('Subject');
    expect(screen.getByLabelText(/^To/)).toHaveValue('jobs@muster.example');
    expect(screen.getByLabelText('Message')).toHaveValue(draft().body);
    await user.clear(subject);
    await user.type(subject, 'Neuer Betreff');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(send).toHaveBeenCalledWith({ to: 'jobs@muster.example', subject: 'Neuer Betreff', body: draft().body });
  });

  it('without connected mail Send is off and the way to Settings is shown', async () => {
    setup({ d: draft({ mailReady: false }) });
    await screen.findByLabelText('Subject');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByText(/Connect your email to send it from here\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '#/settings');
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeEnabled();
  });

  it('a wrong address switches Send off', async () => {
    const { user } = setup({ d: draft({ to: '' }) });
    const to = await screen.findByLabelText(/^To/);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(to, 'bewerbung@firma');
    expect(screen.getByText(/Please check the address/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(to, '.de');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('Copy copies the message text only, then shows "Copied." and the after-copy button', async () => {
    const { run, onDone, user } = setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await screen.findByLabelText('Subject');
    expect(screen.queryByRole('button', { name: 'Mark as reminded' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(writeText).toHaveBeenCalledWith(draft().body);
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark as reminded' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(run).toHaveBeenCalledOnce();
  });

  it('a failed copy says so and offers no after-copy button', async () => {
    const { user } = setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await screen.findByLabelText('Subject');
    await user.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(await screen.findByText('Copying did not work — select the text and copy it yourself.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as reminded' })).not.toBeInTheDocument();
  });

  it('no after-copy button when none is given', async () => {
    const { user } = setup({ afterCopy: false });
    await screen.findByLabelText('Subject');
    await user.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as reminded' })).not.toBeInTheDocument();
  });

  it('a failed send keeps the edited text and shows the error', async () => {
    const { user } = setup({ send: () => Promise.reject(new ApiError('MAIL_AUTH', 'x')) });
    const subject = await screen.findByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'Mein Betreff');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Your email provider did not accept the password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toHaveValue('Mein Betreff');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it.each(['MAIL_REAUTH', 'MAIL_SCOPE'])('%s links to Settings to sign in with Google again', async (code) => {
    const { user } = setup({ send: () => Promise.reject(new ApiError(code, 'x')) });
    await screen.findByLabelText('Subject');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('link', { name: 'Sign in with Google again' })).toHaveAttribute('href', '#/settings');
  });

  it('sent but not saved: the notice and no Send button', async () => {
    const { user } = setup({ send: () => Promise.reject(new ApiError('CONFLICT', 'x', 'sentNotSaved')) });
    await screen.findByLabelText('Subject');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/The email was sent, but the app could not save it/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
