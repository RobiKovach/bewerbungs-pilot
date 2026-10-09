import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { appView } from '../test/applicationFixtures';
import type { ApplicationView, OfferReply } from '../types';
import { OfferReplyDialog } from './OfferReplyDialog';

const reply = (over: Partial<OfferReply> = {}): OfferReply => ({
  offered: '50.000 €', wanted: '55.000 €', body: 'Vielen Dank für das Angebot.', createdAt: '2026-10-09T10:00:00.000Z', updatedAt: '2026-10-09T10:00:00.000Z', ...over,
});
const offerView = (r: OfferReply | null): ApplicationView => appView({}, { status: 'offer', offerReply: r });
const URL = '/api/applications/app1/offer-reply';

function setup(routes: Record<string, RouteHandler>, view: ApplicationView, opts: { pending?: string[] } = {}) {
  const f = mockFetch(routes, opts);
  const onView = vi.fn();
  const onClose = vi.fn();
  const onSend = vi.fn();
  render(<OfferReplyDialog view={view} onView={onView} onClose={onClose} onSend={onSend} />);
  return { f, onView, onClose, onSend, user: userEvent.setup() };
}

describe('OfferReplyDialog', () => {
  it('asks for the two amounts; the wanted one needs a digit; each field holds at most 50 characters', async () => {
    const { user } = setup({}, offerView(null));
    const offered = screen.getByLabelText('What they offered');
    const wanted = screen.getByLabelText('What you want');
    expect(offered).toHaveAttribute('maxlength', '50');
    expect(wanted).toHaveAttribute('maxlength', '50');
    expect(screen.getByText('Write the amount with digits, e.g. 55.000 €.')).toBeInTheDocument();
    const ask = screen.getByRole('button', { name: 'Ask Claude to write the reply' });
    expect(ask).toBeDisabled();
    await user.type(offered, '50.000 €');
    await user.type(wanted, 'more');
    expect(ask).toBeDisabled();
    await user.clear(wanted);
    await user.type(wanted, '55.000 €');
    expect(ask).toBeEnabled();
  });

  it('asks Claude, then shows the editable text with Copy and Send…', async () => {
    const written = offerView(reply());
    const { f, onView, user } = setup({ [`POST ${URL}`]: () => ({ body: written }) }, offerView(null));
    await user.type(screen.getByLabelText('What they offered'), '50.000 €');
    await user.type(screen.getByLabelText('What you want'), '55.000 €');
    await user.click(screen.getByRole('button', { name: 'Ask Claude to write the reply' }));
    expect(await screen.findByLabelText('Your reply')).toHaveValue('Vielen Dank für das Angebot.');
    const post = f.mock.calls.find(([url, init]) => url === URL && init?.method === 'POST');
    expect(JSON.parse(String(post![1]!.body))).toEqual({ offered: '50.000 €', wanted: '55.000 €' });
    expect(onView).toHaveBeenCalledWith(written);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send…' })).toBeEnabled();
  });

  it('shows progress with Cancel; cancelling aborts the request and shows no error', async () => {
    const { user } = setup({}, offerView(null), { pending: [`POST ${URL}`] });
    await user.type(screen.getByLabelText('What they offered'), '50.000 €');
    await user.type(screen.getByLabelText('What you want'), '55.000 €');
    await user.click(screen.getByRole('button', { name: 'Ask Claude to write the reply' }));
    expect(await screen.findByText('Claude is writing the reply…')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Claude is writing the reply…')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('What they offered')).toHaveValue('50.000 €');
  });

  it('LLM_BAD_OUTPUT shows the error and keeps the amounts in the fields', async () => {
    const { user } = setup({ [`POST ${URL}`]: () => ({ status: 502, body: { error: { code: 'LLM_BAD_OUTPUT', detailsForLog: 'x' } } }) }, offerView(null));
    await user.type(screen.getByLabelText('What they offered'), '50.000 €');
    await user.type(screen.getByLabelText('What you want'), '55.000 €');
    await user.click(screen.getByRole('button', { name: 'Ask Claude to write the reply' }));
    expect(await screen.findByText("Claude's answer could not be understood.")).toBeInTheDocument();
    expect(screen.getByLabelText('What they offered')).toHaveValue('50.000 €');
    expect(screen.getByLabelText('What you want')).toHaveValue('55.000 €');
  });

  it('an existing reply opens straight on the text; "Write again" shows the old amounts and asks again', async () => {
    const again = offerView(reply({ body: 'Neuer Text.', wanted: '58.000 €' }));
    const { f, user } = setup({ [`POST ${URL}`]: () => ({ body: again }) }, offerView(reply()));
    expect(screen.getByLabelText('Your reply')).toHaveValue('Vielen Dank für das Angebot.');
    await user.click(screen.getByRole('button', { name: 'Write again' }));
    expect(screen.getByLabelText('What they offered')).toHaveValue('50.000 €');
    const wanted = screen.getByLabelText('What you want');
    await user.clear(wanted);
    await user.type(wanted, '58.000 €');
    await user.click(screen.getByRole('button', { name: 'Ask Claude to write the reply' }));
    expect(await screen.findByLabelText('Your reply')).toHaveValue('Neuer Text.');
    const post = f.mock.calls.find(([url, init]) => url === URL && init?.method === 'POST');
    expect(JSON.parse(String(post![1]!.body))).toEqual({ offered: '50.000 €', wanted: '58.000 €' });
  });

  it('unsaved changes: Copy, Send… and Close are off and "Save the text first." shows; Save patches, Discard restores', async () => {
    const saved = offerView(reply({ body: 'Mein Text.' }));
    const { f, onView, user } = setup({ [`PATCH ${URL}`]: () => ({ body: saved }) }, offerView(reply()));
    const text = screen.getByLabelText('Your reply');
    expect(screen.queryByText('Save the text first.')).not.toBeInTheDocument();
    await user.clear(text);
    await user.type(text, 'Mein Text.');
    expect(screen.getByText('Save the text first.')).toBeInTheDocument();
    for (const name of ['Copy', 'Send…', 'Close', 'Write again']) expect(screen.getByRole('button', { name })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(text).toHaveValue('Vielen Dank für das Angebot.');
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    await user.clear(text);
    await user.type(text, 'Mein Text.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onView).toHaveBeenCalledWith(saved));
    const patch = f.mock.calls.find(([url, init]) => url === URL && init?.method === 'PATCH');
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ body: 'Mein Text.' });
  });

  it('the server trims the text: after Save the trimmed text is shown and nothing stays blocked', async () => {
    const saved = offerView(reply({ body: 'Mein Text.' }));
    const { user } = setup({ [`PATCH ${URL}`]: () => ({ body: saved }) }, offerView(reply()));
    const text = screen.getByLabelText('Your reply');
    await user.clear(text);
    await user.type(text, 'Mein Text.{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(text).toHaveValue('Mein Text.'));
    expect(screen.queryByText('Save the text first.')).not.toBeInTheDocument();
    for (const name of ['Copy', 'Send…', 'Close']) expect(screen.getByRole('button', { name })).toBeEnabled();
  });

  it('Send… hands over to the mail window, Close closes', async () => {
    const { onSend, onClose, user } = setup({}, offerView(reply()));
    await user.click(screen.getByRole('button', { name: 'Send…' }));
    expect(onSend).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Copy puts the text on the clipboard', async () => {
    const { user } = setup({}, offerView(reply()));
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Vielen Dank für das Angebot.');
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
  });
});
