import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { profileWith, viewOf } from '../test/profileFixtures';
import type { Profile, SectionId } from '../types';
import { ProfileProvider } from './ProfileContext';
import { SectionCard } from './SectionCard';

function setup(profile: Profile, id: SectionId, routes: Record<string, RouteHandler> = {}) {
  const f = mockFetch({ 'GET /api/profile': () => ({ body: viewOf(profile) }), ...routes });
  render(<ProfileProvider><SectionCard id={id} /></ProfileProvider>);
  return { f, user: userEvent.setup() };
}
const withName = profileWith((p) => {
  p.sections.personal.data.fullName = 'Max Mustermann';
  p.sections.personal.data.city = 'Berlin';
  p.sections.personal.aiFields = ['fullName'];
});
const job = { id: 'j1', jobTitle: 'Webentwickler', employer: 'Beispiel GmbH', city: '', country: '', from: '2018-07', to: '', description: '' };

describe('SectionCard', () => {
  it('marks only the fields Claude filled in', async () => {
    setup(withName, 'personal');
    const name = await screen.findByLabelText('Full name');
    expect(name.closest('.field')).toHaveTextContent('AI – please check');
    expect(screen.getByLabelText('City').closest('.field')).not.toHaveTextContent('AI – please check');
    expect(screen.getAllByText('AI – please check')).toHaveLength(1);
  });

  it('saves changes; the server decides which marks remain', async () => {
    let sent: unknown = null;
    const saved = profileWith((p) => { p.sections.personal.data.fullName = 'Max Muster'; p.sections.personal.data.city = 'Berlin'; });
    const { user } = setup(withName, 'personal', {
      'PUT /api/profile/sections/personal': (init) => { sent = JSON.parse(String(init?.body)); return { body: viewOf(saved) }; },
    });
    const name = await screen.findByLabelText('Full name');
    await user.clear(name);
    await user.type(name, 'Max Muster');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByDisplayValue('Max Muster')).toBeInTheDocument();
    expect(sent).toMatchObject({ data: { fullName: 'Max Muster', city: 'Berlin' } });
    expect(screen.queryByText('AI – please check')).toBeNull();
  });

  it('"All correct" saves pending edits first, then confirms', async () => {
    const confirmed = profileWith((p) => { p.sections.personal.data.fullName = 'Max'; p.sections.personal.confirmedAt = '2026-09-24T10:00:00.000Z'; });
    const { f, user } = setup(withName, 'personal', {
      'PUT /api/profile/sections/personal': () => ({ body: viewOf(profileWith((p) => { p.sections.personal.data.fullName = 'Max'; })) }),
      'POST /api/profile/sections/personal/confirm': () => ({ body: viewOf(confirmed) }),
    });
    const name = await screen.findByLabelText('Full name');
    await user.clear(name);
    await user.type(name, 'Max');
    await user.click(screen.getByRole('button', { name: 'All correct' }));
    expect(await screen.findByText(/Checked/)).toBeInTheDocument();
    expect(f.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${c[0]}`).slice(1)).toEqual([
      'PUT /api/profile/sections/personal', 'POST /api/profile/sections/personal/confirm',
    ]);
  });

  it('keeps what the person typed when saving fails', async () => {
    const { user } = setup(withName, 'personal', {
      'PUT /api/profile/sections/personal': () => ({ status: 500, body: { error: { code: 'DATA_WRITE_FAILED', detailsForLog: 'disk' } } }),
    });
    const city = await screen.findByLabelText('City');
    await user.clear(city);
    await user.type(city, 'Dresden');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Your changes could not be saved.')).toBeInTheDocument();
    expect(screen.getByLabelText('City')).toHaveValue('Dresden');
  });

  it('blocks saving while a date is written wrongly', async () => {
    const { user } = setup(profileWith((p) => { p.sections.experience.data.items = [job]; }), 'experience');
    const from = await screen.findByLabelText('From');
    await user.clear(from);
    await user.type(from, '05/2021');
    expect(screen.getByText('Please write the date as 2021-05 or 2021.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(from);
    await user.type(from, '2021-05');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('adds and removes entries', async () => {
    let sent: { data: { items: unknown[] } } | null = null;
    const { user } = setup(profileWith((p) => { p.sections.experience.data.items = [job]; }), 'experience', {
      'PUT /api/profile/sections/experience': (init) => { sent = JSON.parse(String(init?.body)); return { body: viewOf(profileWith(() => {})) }; },
    });
    await user.click(await screen.findByRole('button', { name: 'Add a job' }));
    expect(screen.getAllByLabelText('Job title')).toHaveLength(2);
    for (const b of screen.getAllByRole('button', { name: 'Remove' })) await user.click(b);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(sent!.data.items).toEqual([]);
  });
});
