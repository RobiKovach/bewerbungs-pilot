import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import type { ContactProposal, VacancyContact } from '../types';
import { ContactDialog } from './ContactDialog';

const FIND = 'POST /api/vacancies/v1/contact/find';
const PARSE = 'POST /api/vacancies/v1/contact/parse';
const EMPTY: VacancyContact = { email: '', salutation: '', name: '', phone: '', street: '', postcode: '', city: '' };
const proposal = (over: Partial<VacancyContact>): ContactProposal => {
  const p = { ...EMPTY, ...over };
  return { proposal: p, found: (Object.keys(p) as Array<keyof VacancyContact>).filter((k) => p[k] !== '') };
};

function setup(routes: Record<string, RouteHandler> = {}, opts: { pending?: string[]; canAa?: boolean; partnerUrl?: string; initial?: VacancyContact | null; save?: (c: VacancyContact | null) => Promise<void> } = {}) {
  const f = mockFetch(routes, { pending: opts.pending });
  const save = vi.fn(opts.save ?? (() => Promise.resolve()));
  const onClose = vi.fn();
  render(<ContactDialog vacancyId="v1" canAa={opts.canAa ?? true} partnerUrl={opts.partnerUrl ?? ''} initial={opts.initial ?? null} save={save} onClose={onClose} />);
  return { f, save, onClose, user: userEvent.setup() };
}
const body = (f: ReturnType<typeof mockFetch>, key: string) => {
  const call = f.mock.calls.find(([url, init]) => `${init?.method ?? 'GET'} ${url}` === key);
  return JSON.parse(String(call?.[1]?.body)) as unknown;
};

describe('ContactDialog', () => {
  it('shows the AA button with its hint only for AA offers, the partner button only with a partner page', () => {
    setup({}, { canAa: false });
    expect(screen.queryByRole('button', { name: 'Open the offer page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Read the company's page" })).not.toBeInTheDocument();
  });

  it('the AA window finds a contact: the fields are filled, nothing is saved until Save', async () => {
    const { f, save, user } = setup({ [FIND]: () => ({ body: proposal({ name: 'Erika Musterfrau', email: 'e.musterfrau@example.de' }) }) });
    expect(screen.getByText(/An Edge window opens — solve the captcha/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open the offer page' }));
    expect(await screen.findByText('Contact found. Check the fields and press "Save".')).toBeInTheDocument();
    expect(body(f, FIND)).toEqual({ from: 'aa' });
    expect(screen.getByLabelText('Name')).toHaveValue('Erika Musterfrau');
    expect(screen.getByLabelText('Email')).toHaveValue('e.musterfrau@example.de');
    // An AA name often comes without Frau/Herr: "—" until the person picks one.
    expect(screen.getByLabelText('Salutation')).toHaveValue('');
    expect(save).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Salutation'), 'Frau');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...EMPTY, salutation: 'Frau', name: 'Erika Musterfrau', email: 'e.musterfrau@example.de' }));
  });

  it('a found field replaces only itself: what the person had stays for the rest', async () => {
    const initial = { ...EMPTY, street: 'Musterweg 1', postcode: '01069', city: 'Dresden', email: 'old@example.de' };
    const { user } = setup({ [FIND]: () => ({ body: proposal({ email: 'jobs@example.de' }) }) }, { initial });
    await user.click(screen.getByRole('button', { name: 'Open the offer page' }));
    await screen.findByText(/Contact found/);
    expect(screen.getByLabelText('Email')).toHaveValue('jobs@example.de');
    expect(screen.getByLabelText('Street')).toHaveValue('Musterweg 1');
  });

  it('while the window is open every action waits; Cancel aborts the request and the fields stay editable', async () => {
    const { user } = setup({}, { pending: [FIND], partnerUrl: 'https://partner.example.de/job' });
    await user.click(screen.getByRole('button', { name: 'Open the offer page' }));
    expect(screen.getByText(/The Edge window is open\. Solve the captcha/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the offer page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: "Read the company's page" })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Read text' })).toBeDisabled();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/Search stopped — no contact taken/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open the offer page' })).toBeEnabled();
  });

  it('the person closed the window: a calm text, the contact can be typed by hand', async () => {
    const { save, user } = setup({ [FIND]: () => ({ body: { cancelled: true } }) });
    await user.click(screen.getByRole('button', { name: 'Open the offer page' }));
    expect(await screen.findByText(/Search stopped — no contact taken/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Email'), 'hr@example.de');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...EMPTY, email: 'hr@example.de' }));
  });

  it('timeout, no browser and an unreadable page are calm texts, not error pages', async () => {
    const { user } = setup({ [FIND]: () => ({ status: 400, body: { error: { code: 'BAD_REQUEST', detailsForLog: 'x', reason: 'contactTimeout' } } }) });
    await user.click(screen.getByRole('button', { name: 'Open the offer page' }));
    expect(await screen.findByText(/did not appear within 5 minutes/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('no browser → says Edge/Chrome was not found', async () => {
    const { user } = setup({ [FIND]: () => ({ status: 500, body: { error: { code: 'BROWSER_MISSING', detailsForLog: 'x' } } }) });
    await user.click(screen.getByRole('button', { name: 'Open the offer page' }));
    expect(await screen.findByText(/Microsoft Edge or Google Chrome was not found/)).toBeInTheDocument();
  });

  it('the partner page reads with from "partner"; nothing found says so', async () => {
    const { f, user } = setup({ [FIND]: () => ({ body: proposal({}) }) }, { canAa: false, partnerUrl: 'https://partner.example.de/job' });
    await user.click(screen.getByRole('button', { name: "Read the company's page" }));
    expect(await screen.findByText('No contact found. Paste copied text or enter the contact by hand.')).toBeInTheDocument();
    expect(body(f, FIND)).toEqual({ from: 'partner' });
  });

  it('an unreadable partner page is a calm text', async () => {
    const { user } = setup({ [FIND]: () => ({ status: 400, body: { error: { code: 'BAD_REQUEST', detailsForLog: 'x', reason: 'pageUnreadable' } } }) }, { canAa: false, partnerUrl: 'https://partner.example.de/job' });
    await user.click(screen.getByRole('button', { name: "Read the company's page" }));
    expect(await screen.findByText('Could not read the page. Paste copied text or enter the contact by hand.')).toBeInTheDocument();
  });

  it('pasted text is parsed; the text field holds at most 20 000 characters', async () => {
    const { f, user } = setup({ [PARSE]: () => ({ body: proposal({ phone: '+49 351 1234567' }) }) }, { canAa: false });
    const paste = screen.getByLabelText('or paste copied text');
    expect(paste).toHaveAttribute('maxlength', '20000');
    expect(screen.getByRole('button', { name: 'Read text' })).toBeDisabled();
    await user.type(paste, 'Tel. +49 351 1234567');
    await user.click(screen.getByRole('button', { name: 'Read text' }));
    expect(await screen.findByText(/Contact found/)).toBeInTheDocument();
    expect(body(f, PARSE)).toEqual({ text: 'Tel. +49 351 1234567' });
    expect(screen.getByLabelText('Phone')).toHaveValue('+49 351 1234567');
  });

  it('other errors show the error banner', async () => {
    const { user } = setup({ [PARSE]: () => ({ status: 500, body: { error: { code: 'INTERNAL', detailsForLog: 'boom' } } }) }, { canAa: false });
    await user.type(screen.getByLabelText('or paste copied text'), 'x');
    await user.click(screen.getByRole('button', { name: 'Read text' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('empty fields save "no contact"', async () => {
    const { save, user } = setup({}, { canAa: false, initial: { ...EMPTY, salutation: 'Herr', name: 'Max Mustermann' } });
    await user.clear(screen.getByLabelText('Name'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(null));
  });

  it('a salutation without a name is dropped; values are trimmed', async () => {
    const { save, user } = setup({}, { canAa: false, initial: { ...EMPTY, salutation: 'Herr', name: 'Max Mustermann' } });
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('City'), '  Dresden ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...EMPTY, city: 'Dresden' }));
  });

  it('a failed save keeps the dialog open with the error', async () => {
    const { ApiError } = await import('../api');
    const { onClose, user } = setup({}, { canAa: false, save: () => Promise.reject(new ApiError('CONFLICT', 'sent', 'packageSent')) });
    await user.type(screen.getByLabelText('Email'), 'hr@example.de');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('field limits match the server', () => {
    setup({}, { canAa: false });
    expect(screen.getByLabelText('Phone')).toHaveAttribute('maxlength', '40');
    expect(screen.getByLabelText('Street')).toHaveAttribute('maxlength', '120');
    expect(screen.getByLabelText('Postcode')).toHaveAttribute('maxlength', '10');
    expect(screen.getByLabelText('City')).toHaveAttribute('maxlength', '80');
  });
});
