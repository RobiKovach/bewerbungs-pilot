import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { appView, jobState } from '../test/applicationFixtures';
import { ApplicationsPage } from '../pages/ApplicationsPage';
import type { ApplicationView, PersonalFinding } from '../types';
import { PersonalDataWarning } from './PersonalDataWarning';
import { SendDialog } from './SendDialog';
import type { SendDraft } from '../api';

const iban: PersonalFinding = { kind: 'iban', value: 'DE89370400440532013000', where: { part: 'letter', field: 'paragraph', index: 2 } };

function editor(view: ApplicationView) {
  window.location.hash = '#/applications/app1';
  mockFetch({
    'GET /api/applications/app1': () => ({ body: view }),
    'GET /api/applications/job': () => ({ body: jobState() }),
  });
  render(<ApplicationsPage pollMs={10} />);
}

const draft: SendDraft = {
  to: 'jobs@muster.example', subject: 'Bewerbung', body: 'Sehr geehrte Damen und Herren,',
  attachments: [], totalSize: 0, mailReady: true,
};

function sendDialog(checkText: RouteHandler) {
  const f = mockFetch({
    'GET /api/applications/app1/send-draft': () => ({ body: draft }),
    'POST /api/applications/app1/check-text': checkText,
  });
  render(<SendDialog id="app1" onSent={vi.fn()} onClose={vi.fn()} />);
  return { f, user: userEvent.setup() };
}

describe('PersonalDataWarning', () => {
  it('a place this version does not know shows a plain word, not a raw key', () => {
    const odd = { kind: 'email', value: 'x@evil.example', where: { part: 'cv', field: 'footer' } } as unknown as PersonalFinding;
    render(<PersonalDataWarning warnings={[odd]} />);
    expect(screen.getByText('Email address: x@evil.example — this text')).toBeInTheDocument();
    expect(screen.queryByText(/applications.personalData/)).toBeNull();
  });

  it('renders nothing without findings', () => {
    const { container } = render(<PersonalDataWarning warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the kind, the value and the place of every finding', () => {
    render(<PersonalDataWarning warnings={[iban, { kind: 'email', value: 'x@evil.example', where: { part: 'cv', field: 'profil' } }]} />);
    expect(screen.getByText('There is personal data here that is not in your profile')).toBeInTheDocument();
    expect(screen.getByText(/IBAN: DE89370400440532013000 — letter, paragraph 2/)).toBeInTheDocument();
    expect(screen.getByText(/Email address: x@evil\.example — CV, profile text/)).toBeInTheDocument();
  });
});

describe('ApplicationEditor — personal data warning', () => {
  it('shows the warning above "Approve", which stays enabled', async () => {
    editor(appView({ warnings: [iban] }));
    expect(await screen.findByText('There is personal data here that is not in your profile')).toBeInTheDocument();
    expect(screen.getByText(/letter, paragraph 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('shows no block without findings', async () => {
    editor(appView());
    await screen.findByRole('button', { name: 'Approve' });
    expect(screen.queryByText('There is personal data here that is not in your profile')).not.toBeInTheDocument();
  });
});

describe('SendDialog — personal data warning', () => {
  it('checks the edited text after a pause and warns; Send stays enabled', async () => {
    const found: PersonalFinding = { kind: 'email', value: 'evil@x.example', where: { part: 'email', field: 'body' } };
    const { f, user } = sendDialog((init) => {
      const { body } = JSON.parse(String(init?.body)) as { body: string };
      return { body: { warnings: body.includes('evil@x.example') ? [found] : [] } };
    });
    const message = await screen.findByLabelText('Message');
    await user.type(message, ' evil@x.example');
    expect(await screen.findByText('There is personal data here that is not in your profile', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/evil@x\.example — email, message/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(f.mock.calls.some(([url]) => url === '/api/applications/app1/check-text')).toBe(true);
  });

  it('a failing check shows no block and no error', async () => {
    const { f, user } = sendDialog(() => ({ status: 500, body: { error: { code: 'INTERNAL', detailsForLog: 'x' } } }));
    const message = await screen.findByLabelText('Message');
    await user.type(message, ' evil@x.example');
    await waitFor(() => expect(f.mock.calls.some(([url]) => url === '/api/applications/app1/check-text')).toBe(true), { timeout: 2000 });
    expect(screen.queryByText('There is personal data here that is not in your profile')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
});
