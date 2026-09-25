import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../test/fetchMock';
import { profileWith, viewOf } from '../test/profileFixtures';
import type { Profile } from '../types';
import { ProfileProvider } from './ProfileContext';
import { ProfileWizard } from './ProfileWizard';

function setup(step: 1 | 2 | 3 | 4) {
  let profile: Profile = profileWith((p) => { p.wizard.step = step; });
  const sent: unknown[] = [];
  mockFetch({
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
