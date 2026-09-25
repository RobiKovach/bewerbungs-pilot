import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../../test/fetchMock';
import { profileWith, viewOf } from '../../test/profileFixtures';
import type { Profile } from '../../types';
import { ProfileProvider } from '../ProfileContext';
import { UnsavedProvider } from '../unsaved';
import { ReviewStep } from './ReviewStep';

const BANNER = /The new CV differs in these sections/;

function setup(profile: Profile) {
  mockFetch({ 'GET /api/profile': () => ({ body: viewOf(profile) }) });
  render(<ProfileProvider><UnsavedProvider><ReviewStep onNext={vi.fn()} /></UnsavedProvider></ProfileProvider>);
  return userEvent.setup();
}

afterEach(() => { vi.restoreAllMocks(); });

describe('ReviewStep', () => {
  it('lists the sections with a new CV version and takes the person to one', async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this.id); });
    const user = setup(profileWith((p) => {
      p.sections.experience.confirmedAt = '2026-09-24T10:00:00.000Z';
      p.cvProposals.experience = { items: [] };
      p.cvProposals.languages = { items: [{ id: 'l1', language: 'Deutsch', level: 'C1', certificate: '' }] };
    }));
    const banner = (await screen.findByText(BANNER)).closest('.proposals-banner') as HTMLElement;
    expect(within(banner).getAllByRole('button').map((b) => b.textContent)).toEqual(['Work experience', 'Languages']);
    await user.click(within(banner).getByRole('button', { name: 'Languages' }));
    expect(scrolled).toEqual(['profile-section-languages']);
    // In the wizard every section is already open, with its choice box.
    const section = document.getElementById('profile-section-languages') as HTMLElement;
    expect(within(section).getByRole('button', { name: 'Take the new version' })).toBeInTheDocument();
  });

  it('shows no banner without proposals', async () => {
    setup(profileWith(() => {}));
    await screen.findByRole('heading', { name: 'Personal details' });
    expect(screen.queryByText(BANNER)).toBeNull();
  });
});
