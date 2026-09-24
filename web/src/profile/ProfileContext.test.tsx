import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../test/fetchMock';
import { emptyProfile, viewOf } from '../test/profileFixtures';
import { ProfileProvider, useProfile } from './ProfileContext';

function Missing() {
  const { view } = useProfile();
  return <p>{view.readiness.missing.length} missing</p>;
}

describe('ProfileProvider', () => {
  it('loads the profile', async () => {
    mockFetch({ 'GET /api/profile': () => ({ body: viewOf(emptyProfile()) }) });
    render(<ProfileProvider><Missing /></ProfileProvider>);
    expect(await screen.findByText('6 missing')).toBeInTheDocument();
  });
  it('shows a readable error and loads again on retry', async () => {
    let calls = 0;
    mockFetch({
      'GET /api/profile': () => (++calls === 1
        ? { status: 500, body: { error: { code: 'DATA_WRITE_FAILED', detailsForLog: 'x' } } }
        : { body: viewOf(emptyProfile()) }),
    });
    render(<ProfileProvider><Missing /></ProfileProvider>);
    expect(await screen.findByText('Your changes could not be saved.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('6 missing')).toBeInTheDocument();
  });
});
