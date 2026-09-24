import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../../test/fetchMock';
import { emptyProfile, profileWith, viewOf } from '../../test/profileFixtures';
import { ProfileProvider } from '../ProfileContext';
import { ReviewStep } from './ReviewStep';
import { StartStep } from './StartStep';

const pdf = () => new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' });

function setup(routes: Record<string, RouteHandler> = {}) {
  const f = mockFetch({ 'GET /api/profile': () => ({ body: viewOf(emptyProfile()) }), ...routes });
  const onNext = vi.fn();
  render(<ProfileProvider><StartStep onNext={onNext} /></ProfileProvider>);
  return { f, onNext, user: userEvent.setup() };
}

describe('StartStep', () => {
  it('uploads the CV, waits for Claude and moves on', async () => {
    const read = profileWith((p) => { p.sections.personal.data.fullName = 'Max Mustermann'; p.wizard.step = 2; });
    const { onNext, user } = setup({ 'POST /api/profile/cv': () => ({ body: { ...viewOf(read), changedSections: ['personal'] } }) });
    await user.upload(await screen.findByLabelText('Upload your CV (PDF or Word)'), pdf());
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('can be cancelled while Claude reads, without an error', async () => {
    const { f, onNext, user } = setup();
    const routed = f.getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url !== '/api/profile/cv') return routed(url, init);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }));
    await user.upload(await screen.findByLabelText('Upload your CV (PDF or Word)'), pdf());
    expect(await screen.findByText(/Claude is reading your CV/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByLabelText('Upload your CV (PDF or Word)')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('explains an unreadable CV and still offers the way without a CV', async () => {
    const { onNext, user } = setup({ 'POST /api/profile/cv': () => ({ status: 422, body: { error: { code: 'CV_UNREADABLE', detailsForLog: 'scan' } } }) });
    await user.upload(await screen.findByLabelText('Upload your CV (PDF or Word)'), pdf());
    expect(await screen.findByText('We could not read any text in this CV.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fill in without a CV' }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('refuses a too large file before uploading it', async () => {
    const { f, user } = setup();
    const big = pdf();
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await user.upload(await screen.findByLabelText('Upload your CV (PDF or Word)'), big);
    expect(await screen.findByText('This file is too large.')).toBeInTheDocument();
    expect(f.mock.calls.some((c) => c[0] === '/api/profile/cv')).toBe(false);
  });
});

describe('ReviewStep', () => {
  it('shows all six sections and moves on', async () => {
    mockFetch({ 'GET /api/profile': () => ({ body: viewOf(emptyProfile()) }) });
    const onNext = vi.fn();
    render(<ProfileProvider><ReviewStep onNext={onNext} /></ProfileProvider>);
    for (const title of ['Personal details', 'Education', 'Work experience', 'Skills', 'Languages', 'Job wishes']) {
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    }
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledOnce();
  });
});
