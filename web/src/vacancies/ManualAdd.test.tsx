import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { vac, vacancyServer } from '../test/vacancyFixtures';
import { VacanciesPage } from '../pages/VacanciesPage';
import type { Vacancy } from '../types';

const TEXT = 'Frontend Developer (m/w/d) bei der Muster GmbH in Dresden. ' + 'Aufgaben und Profil. '.repeat(12);

function setup(list: Vacancy[], extra: Record<string, RouteHandler>, pending: string[] = []) {
  const server = vacancyServer({ list });
  const f = mockFetch({ ...server.routes, ...extra }, { pending });
  render(<SettingsProvider><VacanciesPage /></SettingsProvider>);
  return { f, user: userEvent.setup() };
}
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: '+ Add' }));
  return screen.getByRole('region', { name: 'Add an offer by hand' });
};

describe('ManualAdd', () => {
  it('needs 200 characters of text or an Arbeitsagentur link', async () => {
    const { user } = setup([], {});
    const panel = await open(user);
    const add = within(panel).getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    await user.type(within(panel).getByLabelText('Text of the offer'), 'zu kurz');
    expect(add).toBeDisabled();
    expect(within(panel).getByText('7 / at least 200 characters')).toBeInTheDocument();
    await user.type(within(panel).getByLabelText('Link (optional)'), 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1111111111-S');
    expect(add).toBeEnabled();
  });

  it('accepts a real-shaped Arbeitsagentur number with underscore/dot/colon, not just letters/digits/hyphens', async () => {
    const { user } = setup([], {});
    const panel = await open(user);
    const add = within(panel).getByRole('button', { name: 'Add' });
    await user.type(within(panel).getByLabelText('Link (optional)'), 'https://www.arbeitsagentur.de/jobsuche/jobdetail/13635-js_bc_85_JB5198077-S');
    expect(add).toBeEnabled();
  });

  it('adds a pasted offer: card on the list, highlighted, edit form open with the check hint', async () => {
    const created = vac({ id: 'm1', source: 'manual', sourceId: null, addedManually: true, title: 'Frontend Developer (m/w/d)', company: 'Muster GmbH', url: '',
      contact: { email: 'bewerbung@muster.example', salutation: 'Frau', name: 'Erika Beispiel' } });
    const { user, f } = setup([], { 'POST /api/vacancies/manual': () => ({ body: { vacancy: created } }) });
    const panel = await open(user);
    const area = within(panel).getByLabelText('Text of the offer');
    await user.click(area);
    await user.paste(TEXT);
    await user.click(within(panel).getByRole('button', { name: 'Add' }));
    const article = (await screen.findByRole('heading', { name: 'Frontend Developer (m/w/d)' })).closest('article') as HTMLElement;
    expect(article).toHaveClass('vacancy--highlight');
    expect(within(article).getByText('Claude filled in these fields — please check them.')).toBeInTheDocument();
    expect(within(article).getByText('Contact: Frau Erika Beispiel · bewerbung@muster.example')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Add an offer by hand' })).toBeNull();
    const body = JSON.parse(String((f.mock.calls.find((c) => c[0] === '/api/vacancies/manual')![1] as RequestInit).body));
    expect(body).toEqual({ text: TEXT.trim() });
  });

  it('a duplicate points to the existing card, also when it is hidden', async () => {
    const hidden = vac({ id: 'old', title: 'Schon da', status: 'hidden', hiddenAt: '2026-09-28T10:00:00.000Z' });
    const { user } = setup([hidden], {
      'POST /api/vacancies/manual': () => ({ status: 409, body: { error: { code: 'VACANCY_DUPLICATE', detailsForLog: 'old', params: { id: 'old' } } } }),
    });
    const panel = await open(user);
    await user.click(within(panel).getByLabelText('Text of the offer'));
    await user.paste(TEXT);
    await user.click(within(panel).getByRole('button', { name: 'Add' }));
    expect(await within(panel).findByText('This offer is already in your list.')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Show it' }));
    expect(screen.getByRole('tab', { name: 'Hidden 1' })).toHaveAttribute('aria-selected', 'true');
    const article = screen.getByRole('heading', { name: 'Schon da' }).closest('article') as HTMLElement;
    expect(article).toHaveClass('vacancy--highlight');
    expect(within(article).getByRole('button', { name: 'Bring back' })).toBeInTheDocument();
  });

  it('cancel while Claude reads: request aborted, text kept', async () => {
    const { user } = setup([], {}, ['POST /api/vacancies/manual']);
    const panel = await open(user);
    const area = within(panel).getByLabelText('Text of the offer');
    await user.click(area);
    await user.paste(TEXT);
    await user.click(within(panel).getByRole('button', { name: 'Add' }));
    expect(await within(panel).findByText('Claude is reading the offer…')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
    expect(within(panel).queryByText('Claude is reading the offer…')).toBeNull();
    expect(area).toHaveValue(TEXT);
  });
});

describe('ManualEdit', () => {
  it('saves the fields of a pasted offer; refuses a non-http link', async () => {
    const m = vac({ id: 'm1', source: 'manual', sourceId: null, addedManually: true, title: 'Alt', company: 'Muster GmbH', url: '' });
    let saved: unknown = null;
    const { user } = setup([m], {
      'PATCH /api/vacancies/m1': (init) => { saved = JSON.parse(String(init?.body)); return { body: { vacancy: { ...m, ...(saved as object) } } }; },
    });
    const article = (await screen.findByRole('heading', { name: 'Alt' })).closest('article') as HTMLElement;
    await user.click(within(article).getByRole('button', { name: 'Edit' }));
    const title = within(article).getByLabelText('Job title');
    await user.clear(title);
    await user.type(title, 'Neu');
    const link = within(article).getByLabelText('Link to the original');
    await user.type(link, 'javascript:alert(1)');
    await user.click(within(article).getByRole('button', { name: 'Save' }));
    expect(within(article).getByText('Please enter a link that starts with https://')).toBeInTheDocument();
    expect(saved).toBeNull();
    await user.clear(link);
    await user.type(link, 'https://muster.example/job');
    await user.click(within(article).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Neu' })).toBeInTheDocument();
    expect(saved).toMatchObject({ title: 'Neu', company: 'Muster GmbH', url: 'https://muster.example/job' });
  });

  it('cards from the job board have no Edit button', async () => {
    setup([vac({ title: 'Vom Amt' })], {});
    const article = (await screen.findByRole('heading', { name: 'Vom Amt' })).closest('article') as HTMLElement;
    expect(within(article).queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});
