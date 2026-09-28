import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

  it('limits a description to the length the server accepts', async () => {
    setup(profileWith((p) => { p.sections.experience.data.items = [job]; }), 'experience');
    expect(await screen.findByLabelText('What you did (in your own words)')).toHaveAttribute('maxLength', '5000');
  });

  it('job wishes: the temporary-work switch is on by default and is saved', async () => {
    const saved: unknown[] = [];
    const { user } = setup(profileWith(() => {}), 'wishes', {
      'PUT /api/profile/sections/wishes': (init) => { saved.push(JSON.parse(String(init?.body))); return { body: viewOf(profileWith(() => {})) }; },
    });
    const box = await screen.findByRole('checkbox', { name: /temporary-work agencies/ });
    expect(box).toBeChecked();
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved.at(-1)).toMatchObject({ data: { includeTemporaryAgencies: false } });
  });

  it('blocks saving when a list has more lines than allowed', async () => {
    const { user } = setup(profileWith(() => {}), 'wishes');
    const titles = await screen.findByLabelText('Jobs you are looking for (one per line)');
    await user.click(titles);
    await user.paste(Array.from({ length: 21 }, (_, i) => `Job ${i}`).join('\n'));
    expect(screen.getByText('Please write at most 20 lines.')).toBeInTheDocument();
    expect(screen.getByText('Please shorten the lists marked in red first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'All correct' })).toBeDisabled();
  });
});

describe('SectionCard with a proposal from a new CV', () => {
  const checked = (change: (p: Profile) => void = () => {}) => profileWith((p) => {
    p.sections.personal.data = { ...p.sections.personal.data, fullName: 'Max Mustermann', city: 'Berlin' };
    p.sections.personal.confirmedAt = '2026-09-24T10:00:00.000Z';
    change(p);
  });
  const withProposal = checked((p) => {
    p.cvProposals.personal = { ...p.sections.personal.data, city: 'Dresden', phone: '+49 30 1234567' };
  });

  it('shows both versions side by side with the form labels, leaving out empty fields', async () => {
    setup(withProposal, 'personal');
    const box = (await screen.findByText('The new CV has a different version of this section')).closest('.proposal') as HTMLElement;
    const now = within(box).getByRole('region', { name: 'Now' });
    const next = within(box).getByRole('region', { name: 'In the new CV' });
    expect(within(now).getByText('City').nextElementSibling).toHaveTextContent('Berlin');
    expect(within(next).getByText('City').nextElementSibling).toHaveTextContent('Dresden');
    expect(within(now).queryByText('Phone')).toBeNull();
    expect(within(next).getByText('Phone').nextElementSibling).toHaveTextContent('+49 30 1234567');
    expect(within(next).getByText('Full name').nextElementSibling).toHaveTextContent('Max Mustermann');
    expect(within(now).queryByText('Email')).toBeNull();
  });

  it('shows list entries as their fields', async () => {
    const job2 = { ...job, id: 'j2', jobTitle: 'Teamleiter', employer: 'Neu AG', from: '2023' };
    setup(profileWith((p) => {
      p.sections.experience.data.items = [job];
      p.sections.experience.confirmedAt = '2026-09-24T10:00:00.000Z';
      p.cvProposals.experience = { items: [{ ...job, id: 'n1' }, job2] };
      p.sections.skills.data.items = [{ id: 's1', name: 'JavaScript', level: 'expert' }];
    }), 'experience');
    const next = await screen.findByRole('region', { name: 'In the new CV' });
    expect(within(next).getAllByText('Job title').map((dt) => dt.nextElementSibling?.textContent)).toEqual(['Webentwickler', 'Teamleiter']);
    expect(within(next).getByText('Neu AG')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Now' })).getAllByText('Job title')).toHaveLength(1);
  });

  it('marks as "Different" only the list entries the other version does not have (ids do not count)', async () => {
    const changed = { ...job, id: 'j2', description: 'Shops gebaut' };
    const added = { ...job, id: 'j3', jobTitle: 'Teamleiter', employer: 'Neu AG', from: '2023' };
    const same = { ...job, id: 'j4', jobTitle: 'Praktikant', from: '2016' };
    setup(profileWith((p) => {
      p.sections.experience.data.items = [job, same];
      p.sections.experience.confirmedAt = '2026-09-24T10:00:00.000Z';
      // job: now without description, in the new CV with one; same: identical apart from the id; added: only in the new CV.
      p.cvProposals.experience = { items: [changed, { ...same, id: 'n4' }, added] };
    }), 'experience');
    const entries = (name: string) => [...screen.getByRole('region', { name }).querySelectorAll('.proposal-entry')] as HTMLElement[];
    const marked = (name: string) => entries(name).map((e) => [
      within(e).getByText('Job title').nextElementSibling?.textContent, within(e).queryAllByText('Different').length,
    ]);
    await screen.findByRole('region', { name: 'In the new CV' });
    expect(marked('Now')).toEqual([['Webentwickler', 1], ['Praktikant', 0]]);
    expect(marked('In the new CV')).toEqual([['Webentwickler', 1], ['Praktikant', 0], ['Teamleiter', 1]]);
  });

  it('marks as "Different" each personal field that changed', async () => {
    setup(withProposal, 'personal');
    const next = await screen.findByRole('region', { name: 'In the new CV' });
    const differs = (region: HTMLElement) => [...region.querySelectorAll('div.differs dt')].map((dt) => dt.textContent);
    expect(differs(next)).toEqual(['Phone', 'City']);
    expect(differs(screen.getByRole('region', { name: 'Now' }))).toEqual(['City']);
  });

  it('"Take the new version" asks the server and shows the new data', async () => {
    const taken = profileWith((p) => {
      p.sections.personal.data = { ...withProposal.cvProposals.personal! };
      p.sections.personal.aiFields = ['fullName', 'phone', 'city'];
    });
    let sent: unknown = null;
    const { user } = setup(withProposal, 'personal', {
      'POST /api/profile/sections/personal/proposal/accept': (init) => { sent = JSON.parse(String(init?.body)); return { body: viewOf(taken) }; },
    });
    await user.click(await screen.findByRole('button', { name: 'Take the new version' }));
    expect(await screen.findByDisplayValue('Dresden')).toBeInTheDocument();
    expect(screen.queryByText('The new CV has a different version of this section')).toBeNull();
    // The server checks that this is still the version the person saw.
    expect(sent).toEqual({ seen: JSON.stringify(withProposal.cvProposals.personal) });
  });

  it('sends the version it showed without the entry ids', async () => {
    let sent: { seen: string } | null = null;
    const proposal = { items: [{ id: 'n1', name: 'TypeScript', level: 'good' as const }] };
    const { user } = setup(profileWith((p) => {
      p.sections.skills.confirmedAt = '2026-09-24T10:00:00.000Z';
      p.cvProposals.skills = proposal;
    }), 'skills', {
      'POST /api/profile/sections/skills/proposal/accept': (init) => { sent = JSON.parse(String(init?.body)); return { body: viewOf(profileWith(() => {})) }; },
    });
    await user.click(await screen.findByRole('button', { name: 'Take the new version' }));
    await waitFor(() => expect(sent).toEqual({ seen: '{"items":[{"name":"TypeScript","level":"good"}]}' }));
  });

  it('when the new CV changed again meanwhile, shows the current version and says so instead of taking it', async () => {
    const changed = checked((p) => { p.cvProposals.personal = { ...p.sections.personal.data, city: 'Leipzig' }; });
    const { user } = setup(withProposal, 'personal', {
      'POST /api/profile/sections/personal/proposal/accept': () => ({
        status: 409,
        body: { error: { code: 'CONFLICT', detailsForLog: 'changed', reason: 'proposalChanged' }, view: viewOf(changed) },
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Take the new version' }));
    expect(await screen.findByText('This was changed in the meantime.')).toBeInTheDocument();
    expect(screen.getByText('The new CV changed again — please look at it once more.')).toBeInTheDocument();
    const next = screen.getByRole('region', { name: 'In the new CV' });
    expect(within(next).getByText('City').nextElementSibling).toHaveTextContent('Leipzig');
    expect(screen.getByLabelText('City')).toHaveValue('Berlin');
  });

  it('"Keep mine" asks the server and keeps the current data', async () => {
    const { f, user } = setup(withProposal, 'personal', {
      'POST /api/profile/sections/personal/proposal/reject': () => ({ body: viewOf(checked()) }),
    });
    await user.click(await screen.findByRole('button', { name: 'Keep mine' }));
    await waitFor(() => expect(screen.queryByText('The new CV has a different version of this section')).toBeNull());
    expect(screen.getByLabelText('City')).toHaveValue('Berlin');
    expect(f.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${c[0]}`).slice(1)).toEqual([
      'POST /api/profile/sections/personal/proposal/reject',
    ]);
  });

  it('holds "Take the new version" back while the section has unsaved changes', async () => {
    const { user } = setup(withProposal, 'personal');
    const city = await screen.findByLabelText('City');
    await user.clear(city);
    await user.type(city, 'Leipzig');
    expect(screen.getByRole('button', { name: 'Take the new version' })).toBeDisabled();
    expect(screen.getByText('Please save or undo your changes in this section first.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('button', { name: 'Take the new version' })).toBeEnabled();
  });

  it('shows no box without a proposal', async () => {
    setup(checked(), 'personal');
    await screen.findByLabelText('City');
    expect(screen.queryByText('The new CV has a different version of this section')).toBeNull();
  });
});
