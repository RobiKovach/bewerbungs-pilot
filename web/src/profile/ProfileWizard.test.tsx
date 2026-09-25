import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { profileWith, viewOf } from '../test/profileFixtures';
import type { Profile } from '../types';
import { ProfileProvider } from './ProfileContext';
import { ProfileWizard } from './ProfileWizard';

const UNSAVED = 'Some changes are not saved yet. Please save them or undo them before you go on.';

function setup(step: 1 | 2 | 3 | 4, change: (p: Profile) => void = () => {}, routes: Record<string, RouteHandler> = {}) {
  let profile: Profile = profileWith((p) => { p.wizard.step = step; change(p); });
  const sent: unknown[] = [];
  mockFetch({
    ...routes,
    'GET /api/profile': () => ({ body: viewOf(profile) }),
    'PUT /api/profile/wizard': (init) => {
      const body = JSON.parse(String(init?.body)) as { step: 1 | 2 | 3 | 4; completed?: boolean };
      sent.push(body);
      profile = profileWith((p) => { p.wizard = { step: body.step, completedAt: body.completed ? '2026-09-24T12:00:00.000Z' : null }; });
      return { body: viewOf(profile) };
    },
  });
  const onDone = vi.fn();
  render(<ProfileProvider><ProfileWizard onDone={onDone} /></ProfileProvider>);
  return { sent, onDone, user: userEvent.setup() };
}

describe('ProfileWizard', () => {
  it('resumes at the saved step', async () => {
    setup(3);
    expect(await screen.findByText('Step 3 of 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Questions and stories' })).toBeInTheDocument();
  });
  it('saves the next step and goes back', async () => {
    const { sent, user } = setup(2);
    await screen.findByText('Step 2 of 4');
    await user.click(screen.getAllByRole('button', { name: 'Next' }).at(-1)!);
    expect(await screen.findByText('Step 3 of 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Step 2 of 4')).toBeInTheDocument();
    expect(sent).toEqual([{ step: 3 }, { step: 2 }]);
  });
  it('blocks Next and Back while a section has unsaved changes, until it is saved', async () => {
    const saved = profileWith((p) => { p.wizard.step = 2; p.sections.personal.data.fullName = 'Max'; });
    const { sent, user } = setup(2, () => {}, { 'PUT /api/profile/sections/personal': () => ({ body: viewOf(saved) }) });
    await user.type(await screen.findByLabelText('Full name'), 'Max');
    const next = () => screen.getAllByRole('button', { name: 'Next' }).at(-1)!;
    expect(next()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await vi.waitFor(() => expect(next()).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(screen.queryByText(UNSAVED)).toBeNull();
    expect(sent).toEqual([]);
  });
  it('"Discard changes" undoes a section edit and unblocks Next', async () => {
    const { user } = setup(2);
    await user.type(await screen.findByLabelText('Full name'), 'Max');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Full name')).toHaveValue('');
    expect(screen.getAllByRole('button', { name: 'Next' }).at(-1)).toBeEnabled();
  });
  it('blocks Next and Back while a follow-up answer is typed but not sent', async () => {
    const { user } = setup(3, (p) => { p.pendingQuestions = [{ id: 'q1', question: 'What project are you proud of?', why: 'Stories beat lists.' }]; });
    await user.type(await screen.findByLabelText('What project are you proud of?'), 'A bakery website');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('What project are you proud of?'));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
  it('"Fill in without a CV" goes to step 2', async () => {
    const { sent, user } = setup(1);
    await user.click(await screen.findByRole('button', { name: 'Fill in without a CV' }));
    expect(await screen.findByText('Step 2 of 4')).toBeInTheDocument();
    expect(sent).toEqual([{ step: 2 }]);
  });
  it('finishes on the last step', async () => {
    const { sent, onDone, user } = setup(4);
    await user.click(await screen.findByRole('button', { name: 'Finish' }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(sent).toEqual([{ step: 4, completed: true }]);
  });
});
