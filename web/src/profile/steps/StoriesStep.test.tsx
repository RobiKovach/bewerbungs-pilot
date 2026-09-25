import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../../test/fetchMock';
import { emptyProfile, profileWith, viewOf } from '../../test/profileFixtures';
import type { Profile } from '../../types';
import { ProfileProvider } from '../ProfileContext';
import { UnsavedProvider } from '../unsaved';
import { StoriesStep } from './StoriesStep';

const QUESTIONS = [
  { id: 'q1', question: 'What project are you proud of?', why: 'Stories beat lists.' },
  { id: 'q2', question: 'Who was it for?', why: 'Clients matter.' },
];
const asked = profileWith((p) => { p.pendingQuestions = QUESTIONS; });
const story = { id: 's1', title: 'Bakery website', text: 'I built a website for a bakery.', kind: 'client' as const, disclosure: 'ok' as const, confirmed: false };
const withStory = profileWith((p) => { p.stories = [story]; });

function setup(profile: Profile, routes: Record<string, RouteHandler> = {}) {
  const f = mockFetch({ 'GET /api/profile': () => ({ body: viewOf(profile) }), ...routes });
  const onNext = vi.fn();
  // Inside a provider like in the wizard, so Next shows whether something is unsaved.
  render(<ProfileProvider><UnsavedProvider><StoriesStep onNext={onNext} /></UnsavedProvider></ProfileProvider>);
  return { f, onNext, user: userEvent.setup() };
}
const bodyOf = (f: ReturnType<typeof mockFetch>, key: string) => {
  const call = f.mock.calls.find((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${c[0]}` === key)!;
  return JSON.parse(String((call[1] as RequestInit).body));
};

describe('StoriesStep', () => {
  it('asks Claude for questions and shows them', async () => {
    const { user } = setup(emptyProfile(), { 'POST /api/profile/followups': () => ({ body: viewOf(asked) }) });
    await user.click(await screen.findByRole('button', { name: 'Ask me questions' }));
    expect(await screen.findByLabelText('What project are you proud of?')).toBeInTheDocument();
    expect(screen.getByText('Stories beat lists.')).toBeInTheDocument();
  });

  it('sends only answered questions and shows the new stories to check', async () => {
    const { f, user } = setup(asked, { 'POST /api/profile/stories/structure': () => ({ body: viewOf(withStory) }) });
    await user.type(await screen.findByLabelText('What project are you proud of?'), 'A website for a bakery');
    await user.click(screen.getByRole('button', { name: 'Turn my answers into stories' }));
    expect(await screen.findByText('New — please check')).toBeInTheDocument();
    expect(bodyOf(f, 'POST /api/profile/stories/structure')).toEqual({ answers: [{ questionId: 'q1', answer: 'A website for a bakery' }] });
  });

  it('keeps the answers when Claude fails', async () => {
    const { user } = setup(asked, {
      'POST /api/profile/stories/structure': () => ({ status: 504, body: { error: { code: 'LLM_TIMEOUT', detailsForLog: 'slow' } } }),
    });
    await user.type(await screen.findByLabelText('Who was it for?'), 'A bakery in Dresden');
    await user.click(screen.getByRole('button', { name: 'Turn my answers into stories' }));
    expect(await screen.findByText('Claude took too long to answer.')).toBeInTheDocument();
    expect(screen.getByLabelText('Who was it for?')).toHaveValue('A bakery in Dresden');
  });

  it('confirms a story', async () => {
    const { f, user } = setup(withStory, { 'PUT /api/profile/stories/s1': () => ({ body: viewOf(profileWith((p) => { p.stories = [{ ...story, confirmed: true }]; })) }) });
    await user.click(await screen.findByRole('button', { name: 'This is right' }));
    expect(bodyOf(f, 'PUT /api/profile/stories/s1')).toEqual({ title: story.title, text: story.text, kind: 'client', disclosure: 'ok', confirmed: true });
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByText('New — please check')).toBeNull();
  });

  it('asks once more before deleting a story', async () => {
    const { f, user } = setup(withStory, { 'DELETE /api/profile/stories/s1': () => ({ body: viewOf(emptyProfile()) }) });
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(f.mock.calls.some((c) => c[0] === '/api/profile/stories/s1')).toBe(false);
    expect(screen.getByDisplayValue('Bakery website')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Really delete?' }));
    await waitFor(() => expect(screen.queryByDisplayValue('Bakery website')).toBeNull());
  });

  it('lets the person write a story themselves', async () => {
    const { f, user } = setup(emptyProfile(), { 'POST /api/profile/stories': () => ({ body: viewOf(profileWith((p) => { p.stories = [{ ...story, confirmed: true }]; })) }) });
    await user.click(await screen.findByRole('button', { name: 'Write a story yourself' }));
    await user.type(screen.getByLabelText('Title'), 'Bakery website');
    await user.type(screen.getByLabelText('Story'), 'I built a website for a bakery.');
    await user.click(screen.getByRole('button', { name: 'Add story' }));
    expect(bodyOf(f, 'POST /api/profile/stories')).toEqual({ title: 'Bakery website', text: 'I built a website for a bakery.', kind: 'work', disclosure: 'ok' });
  });

  it('saves the never-mention list', async () => {
    const { f, user } = setup(emptyProfile(), { 'PUT /api/profile/never-mention': () => ({ body: viewOf(profileWith((p) => { p.neverMention = ['Kunde X', 'Projekt Y']; })) }) });
    await user.type(await screen.findByLabelText('Never mention'), 'Kunde X\n  \nProjekt Y ');
    await user.click(screen.getByRole('button', { name: 'Save list' }));
    expect(bodyOf(f, 'PUT /api/profile/never-mention')).toEqual(['Kunde X', 'Projekt Y']);
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
  });

  it('skips the questions without making stories', async () => {
    const { f, user } = setup(asked, { 'DELETE /api/profile/followups': () => ({ body: viewOf(emptyProfile()) }) });
    await user.type(await screen.findByLabelText('Who was it for?'), 'never mind');
    await user.click(screen.getByRole('button', { name: 'Skip these questions' }));
    expect(await screen.findByRole('button', { name: 'Ask me questions' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Who was it for?')).toBeNull();
    expect(f.mock.calls.some((c) => c[0] === '/api/profile/stories/structure')).toBe(false);
  });

  it('blocks saving a never-mention list that is too long', async () => {
    const { user } = setup(emptyProfile());
    await user.click(await screen.findByLabelText('Never mention'));
    await user.paste(Array.from({ length: 51 }, (_, i) => `Kunde ${i}`).join('\n'));
    expect(screen.getByText('Please write at most 50 lines.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save list' })).toBeDisabled();
  });

  it('discards unsaved changes to the never-mention list', async () => {
    const { f, user } = setup(profileWith((p) => { p.neverMention = ['Kunde A']; }));
    const field = await screen.findByLabelText('Never mention');
    const card = field.closest('.card') as HTMLElement;
    expect(within(card).queryByRole('button', { name: 'Discard changes' })).toBeNull();
    await user.type(field, '{Enter}Kunde B');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(within(card).getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Never mention')).toHaveValue('Kunde A');
    expect(within(card).queryByRole('button', { name: 'Discard changes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(f.mock.calls.some((c) => c[0] === '/api/profile/never-mention')).toBe(false);
  });

  it('discards typed answers to the questions', async () => {
    const { user } = setup(asked);
    await user.type(await screen.findByLabelText('Who was it for?'), 'A bakery');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Who was it for?')).toHaveValue('');
    expect(screen.getByLabelText('What project are you proud of?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('moves on with Next', async () => {
    const { onNext, user } = setup(emptyProfile());
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledOnce();
  });
});
