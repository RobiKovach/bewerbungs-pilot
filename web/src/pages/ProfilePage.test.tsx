import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../test/fetchMock';
import { emptyProfile, profileWith, viewOf } from '../test/profileFixtures';
import { ProfilePage } from './ProfilePage';

const done = (change: Parameters<typeof profileWith>[0] = () => {}) => profileWith((p) => {
  p.wizard = { step: 4, completedAt: '2026-09-24T12:00:00.000Z' };
  change(p);
});

describe('ProfilePage', () => {
  it('shows the wizard while the profile was never completed', async () => {
    mockFetch({ 'GET /api/profile': () => ({ body: viewOf(emptyProfile()) }) });
    render(<ProfilePage />);
    expect(await screen.findByText('Step 1 of 4')).toBeInTheDocument();
  });

  it('shows what is missing and opens a section for editing', async () => {
    mockFetch({ 'GET /api/profile': () => ({ body: viewOf(done((p) => { p.sections.personal.confirmedAt = '2026-09-24T12:00:00.000Z'; })) }) });
    render(<ProfilePage />);
    const banner = await screen.findByText(/Before BewerbungsPilot can write applications/);
    const list = within(banner.closest('.readiness') as HTMLElement).getAllByRole('listitem').map((li) => li.textContent);
    expect(list).toEqual(['Education', 'Work experience', 'Skills', 'Languages', 'Job wishes']);
    expect(screen.getByText(/no checked story yet/)).toBeInTheDocument();
    const card = screen.getByRole('heading', { name: 'Skills' }).closest('.card') as HTMLElement;
    await userEvent.setup().click(within(card).getByRole('button', { name: 'Edit' }));
    expect(within(card).getByRole('button', { name: 'Add a skill' })).toBeInTheDocument();
  });

  it('says when the profile is ready', async () => {
    const ready = done((p) => {
      for (const s of Object.values(p.sections)) s.confirmedAt = '2026-09-24T12:00:00.000Z';
      p.stories = [{ id: 's1', title: 'T', text: 'X', kind: 'work', disclosure: 'ok', confirmed: true }];
    });
    mockFetch({ 'GET /api/profile': () => ({ body: viewOf(ready) }) });
    render(<ProfilePage />);
    expect(await screen.findByText('Your profile is ready for applications.')).toBeInTheDocument();
    expect(screen.queryByText(/no checked story yet/)).toBeNull();
  });

  it('after replacing the CV names the sections to check again and keeps the others checked', async () => {
    const before = done((p) => {
      p.cv = { id: 'c1', ext: '.pdf', originalName: 'cv-alt.pdf', size: 1, uploadedAt: '2026-09-24T10:00:00.000Z' };
      p.sections.personal.confirmedAt = '2026-09-24T11:00:00.000Z';
      p.sections.experience.confirmedAt = '2026-09-24T11:00:00.000Z';
    });
    const after = done((p) => {
      p.cv = { id: 'c2', ext: '.pdf', originalName: 'cv-neu.pdf', size: 1, uploadedAt: '2026-09-24T12:00:00.000Z' };
      p.sections.personal.confirmedAt = '2026-09-24T11:00:00.000Z';
      p.sections.experience.aiFields = ['items.x.jobTitle'];
    });
    mockFetch({
      'GET /api/profile': () => ({ body: viewOf(before) }),
      'POST /api/profile/cv': () => ({ body: { ...viewOf(after), changedSections: ['experience'], proposedSections: [] } }),
    });
    render(<ProfilePage />);
    await userEvent.setup().upload(await screen.findByLabelText('Replace CV'), new File(['%PDF'], 'cv-neu.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('Please check these sections again: Work experience')).toBeInTheDocument();
    expect(screen.getByText('Current CV: cv-neu.pdf')).toBeInTheDocument();
    const personal = screen.getByRole('heading', { name: 'Personal details' }).closest('.card') as HTMLElement;
    expect(within(personal).getByText(/Checked/)).toBeInTheDocument();
    const experience = screen.getByRole('heading', { name: 'Work experience' }).closest('.card') as HTMLElement;
    expect(within(experience).getByText('Please check')).toBeInTheDocument();
    // The notice can be closed once read.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hide this message' }));
    expect(screen.queryByText('Please check these sections again: Work experience')).toBeNull();
  });

  it('after replacing the CV names the sections where the person has to choose', async () => {
    const cv = (id: string, name: string) => ({ id, ext: '.pdf' as const, originalName: name, size: 1, uploadedAt: '2026-09-24T10:00:00.000Z' });
    const before = done((p) => {
      p.cv = cv('c1', 'cv-alt.pdf');
      p.sections.personal.confirmedAt = '2026-09-24T11:00:00.000Z';
    });
    const after = done((p) => {
      p.cv = cv('c2', 'cv-neu.pdf');
      p.sections.personal.confirmedAt = '2026-09-24T11:00:00.000Z';
      p.cvProposals.personal = { ...p.sections.personal.data, city: 'Dresden' };
    });
    mockFetch({
      'GET /api/profile': () => ({ body: viewOf(before) }),
      'POST /api/profile/cv': () => ({ body: { ...viewOf(after), changedSections: ['experience'], proposedSections: ['personal'] } }),
    });
    render(<ProfilePage />);
    await userEvent.setup().upload(await screen.findByLabelText('Replace CV'), new File(['%PDF'], 'cv-neu.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('Please check these sections again: Work experience')).toBeInTheDocument();
    expect(screen.getByText(/nothing was changed there.*Personal details/i)).toBeInTheDocument();
  });

  it('lists the sections with a new CV version and opens one to choose', async () => {
    mockFetch({ 'GET /api/profile': () => ({ body: viewOf(done((p) => {
      p.cvProposals.skills = { items: [{ id: 'n1', name: 'TypeScript', level: 'good' }] };
      p.cvProposals.languages = { items: [] };
    })) }) });
    render(<ProfilePage />);
    const banner = (await screen.findByText(/The new CV differs in these sections/)).closest('.proposals-banner') as HTMLElement;
    const buttons = within(banner).getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Skills', 'Languages']);
    await userEvent.setup().click(within(banner).getByRole('button', { name: 'Skills' }));
    const card = screen.getByRole('heading', { name: 'Skills' }).closest('.card') as HTMLElement;
    expect(within(card).getByText('New CV: please choose')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Take the new version' })).toBeInTheDocument();
  });

  it('shows no choice banner without proposals', async () => {
    mockFetch({ 'GET /api/profile': () => ({ body: viewOf(done()) }) });
    render(<ProfilePage />);
    await screen.findByText(/Before BewerbungsPilot can write applications/);
    expect(screen.queryByText(/The new CV differs in these sections/)).toBeNull();
  });
});

describe('ProfilePage overview: unsaved changes are never dropped silently', () => {
  const HINT = 'Some changes are not saved yet. Please save them or undo them before you go on.';
  const cardOf = (title: string) => screen.getByRole('heading', { name: title }).closest('.card') as HTMLElement;
  const withCv = done((p) => {
    p.cv = { id: 'c1', ext: '.pdf', originalName: 'cv.pdf', size: 1, uploadedAt: '2026-09-24T10:00:00.000Z' };
    p.cvProposals.skills = { items: [{ id: 'n1', name: 'TypeScript', level: 'good' }] };
  });

  it('holds Close, the other panels, the choice banner and "Replace CV" while a section has unsaved changes', async () => {
    mockFetch({ 'GET /api/profile': () => ({ body: viewOf(withCv) }) });
    render(<ProfilePage />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Personal details' });
    await user.click(within(cardOf('Personal details')).getByRole('button', { name: 'Edit' }));
    const city = within(cardOf('Personal details')).getByLabelText('City');
    await user.type(city, 'Dresden');

    expect(within(cardOf('Personal details')).getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(within(cardOf('Personal details')).getByText(HINT)).toBeInTheDocument();
    expect(within(cardOf('Skills')).getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(within(cardOf('Stories for cover letters')).getByRole('button', { name: 'Add stories' })).toBeDisabled();
    const banner = screen.getByText(/The new CV differs in these sections/).closest('.proposals-banner') as HTMLElement;
    expect(within(banner).getByRole('button', { name: 'Skills' })).toBeDisabled();
    // A new CV could replace the section under the form: held back too.
    expect(screen.getByLabelText('Replace CV')).toBeDisabled();
    expect(within(cardOf('CV')).getByText(HINT)).toBeInTheDocument();

    await user.click(within(cardOf('Personal details')).getByRole('button', { name: 'Discard changes' }));
    expect(within(cardOf('Personal details')).getByRole('button', { name: 'Close' })).toBeEnabled();
    expect(within(cardOf('Skills')).getByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(screen.getByLabelText('Replace CV')).toBeEnabled();
    expect(screen.queryByText(HINT)).toBeNull();
    await user.click(within(cardOf('Personal details')).getByRole('button', { name: 'Close' }));
    expect(within(cardOf('Personal details')).queryByLabelText('City')).toBeNull();
  });

  it('holds Close of the stories panel while "never mention" has unsaved changes', async () => {
    mockFetch({ 'GET /api/profile': () => ({ body: viewOf(done()) }) });
    render(<ProfilePage />);
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole('heading', { name: 'Stories for cover letters' }).then((h) => h.closest('.card') as HTMLElement))
      .getByRole('button', { name: 'Add stories' }));
    await user.type(screen.getByLabelText('Never mention'), 'Kunde X');
    for (const close of within(cardOf('Stories for cover letters')).getAllByRole('button', { name: 'Close' })) expect(close).toBeDisabled();
    expect(within(cardOf('Personal details')).getByRole('button', { name: 'Edit' })).toBeDisabled();
  });
});
