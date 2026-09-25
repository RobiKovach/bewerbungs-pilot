import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../../test/fetchMock';
import { emptyProfile, profileWith, viewOf } from '../../test/profileFixtures';
import type { Profile, ProfileDocument } from '../../types';
import { ProfileProvider } from '../ProfileContext';
import { UnsavedProvider } from '../unsaved';
import { FilesStep } from './FilesStep';

// jsdom has neither a canvas nor pointer-drag support: the cropper reports a fixed area, cropping returns a tiny JPEG.
vi.mock('react-easy-crop', async () => {
  const { createElement, useEffect } = await import('react');
  return {
    default: function FakeCropper({ onCropComplete }: { onCropComplete: (area: unknown, pixels: unknown) => void }) {
      useEffect(() => { onCropComplete({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 300, height: 400 }); }, [onCropComplete]);
      return createElement('div', { 'data-testid': 'cropper' });
    },
  };
});
vi.mock('../cropImage', () => ({ cropToJpeg: vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' })) }));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:picked-photo');
  URL.revokeObjectURL = vi.fn();
});

const doc = (i: number): ProfileDocument => ({
  id: `d${i}`, ext: '.pdf', originalName: `d${i}.pdf`, size: 10, uploadedAt: '2026-09-24T10:00:00.000Z', label: `Zeugnis ${i}`, attachAlways: false,
});
const withPhoto = profileWith((p) => { p.photo = { id: 'p1', ext: '.jpg', originalName: 'photo.jpg', size: 10, uploadedAt: '2026-09-24T10:00:00.000Z' }; });

function setup(profile: Profile, routes: Record<string, RouteHandler> = {}, opts: { applyAccept?: boolean } = {}) {
  const f = mockFetch({ 'GET /api/profile': () => ({ body: viewOf(profile) }), ...routes });
  const onNext = vi.fn();
  // Inside a provider like in the wizard, so the step's button shows whether something is unsaved.
  render(<ProfileProvider><UnsavedProvider><FilesStep onNext={onNext} /></UnsavedProvider></ProfileProvider>);
  return { f, onNext, user: userEvent.setup(opts) };
}
const png = () => new File(['png'], 'me.png', { type: 'image/png' });

describe('FilesStep', () => {
  it('crops the chosen photo and uploads it as JPEG', async () => {
    const { f, user } = setup(emptyProfile(), { 'POST /api/profile/files?kind=photo': () => ({ body: viewOf(withPhoto) }) });
    await user.upload(await screen.findByLabelText('Choose a photo (JPG or PNG)'), png());
    expect(await screen.findByTestId('cropper')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use this part' }));
    expect(await screen.findByRole('img', { name: 'Your CV photo' })).toHaveAttribute('src', '/api/profile/files/p1');
    const sent = (f.mock.calls.find((c) => c[0] === '/api/profile/files?kind=photo')![1] as RequestInit).body as FormData;
    expect((sent.get('file') as File).name).toBe('photo.jpg');
  });

  it('refuses a GIF', async () => {
    const { user } = setup(emptyProfile(), {}, { applyAccept: false });
    await user.upload(await screen.findByLabelText('Choose a photo (JPG or PNG)'), new File(['gif'], 'a.gif', { type: 'image/gif' }));
    expect(await screen.findByText('This type of file cannot be used here.')).toBeInTheDocument();
    expect(screen.queryByTestId('cropper')).toBeNull();
  });

  it('removes the photo', async () => {
    const { f, user } = setup(withPhoto, { 'DELETE /api/profile/files/p1': () => ({ body: viewOf(emptyProfile()) }) });
    await user.click(await screen.findByRole('button', { name: 'Remove photo' }));
    expect(await screen.findByText(/No photo yet/)).toBeInTheDocument();
    expect(f.mock.calls.some((c) => c[0] === '/api/profile/files/p1')).toBe(true);
  });

  it('uploads a document with its name and the attach flag', async () => {
    const url = `/api/profile/files?kind=document&label=${encodeURIComponent('Zeugnis Ausbildung')}&attachAlways=1`;
    const { f, user } = setup(emptyProfile(), { [`POST ${url}`]: () => ({ body: viewOf(profileWith((p) => { p.documents = [{ ...doc(1), label: 'Zeugnis Ausbildung', attachAlways: true }]; })) }) });
    await user.type(await screen.findByLabelText(/Name of the new document/), 'Zeugnis Ausbildung');
    await user.click(screen.getByLabelText('Attach to every application'));
    await user.upload(screen.getByLabelText('Add a PDF document'), new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('1 of 20 documents')).toBeInTheDocument();
    expect(f.mock.calls.some((c) => c[0] === url)).toBe(true);
  });

  it('stops at 20 documents without uploading', async () => {
    const full = profileWith((p) => { p.documents = Array.from({ length: 20 }, (_, i) => doc(i)); });
    const { f, user } = setup(full);
    await user.upload(await screen.findByLabelText('Add a PDF document'), new File(['%PDF'], 'x.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('You already have 20 documents.')).toBeInTheDocument();
    expect(f.mock.calls.some((c) => String(c[0]).startsWith('/api/profile/files?'))).toBe(false);
  });

  it('changes a document and asks once more before deleting it', async () => {
    const one = profileWith((p) => { p.documents = [doc(1)]; });
    const { f, user } = setup(one, {
      'PUT /api/profile/files/d1': () => ({ body: viewOf(profileWith((p) => { p.documents = [{ ...doc(1), attachAlways: true }]; })) }),
      'DELETE /api/profile/files/d1': () => ({ body: viewOf(emptyProfile()) }),
    });
    const row = (await screen.findByDisplayValue('Zeugnis 1')).closest('.document-row') as HTMLElement;
    await user.click(within(row).getByLabelText('Attach to every application'));
    await user.click(within(row).getByRole('button', { name: 'Save' }));
    const put = f.mock.calls.find((c) => c[0] === '/api/profile/files/d1' && (c[1] as RequestInit).method === 'PUT')!;
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ label: 'Zeugnis 1', attachAlways: true });
    const row2 = (await screen.findByDisplayValue('Zeugnis 1')).closest('.document-row') as HTMLElement;
    await user.click(within(row2).getByRole('button', { name: 'Delete' }));
    await user.click(within(row2).getByRole('button', { name: 'Really delete?' }));
    expect(await screen.findByText('0 of 20 documents')).toBeInTheDocument();
  });

  it('limits document names to the length the server accepts', async () => {
    setup(profileWith((p) => { p.documents = [doc(1)]; }));
    expect(await screen.findByLabelText(/Name of the new document/)).toHaveAttribute('maxLength', '300');
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxLength', '300');
  });

  it('finishes with Finish', async () => {
    const { onNext, user } = setup(emptyProfile());
    await user.click(await screen.findByRole('button', { name: 'Finish' }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('discards unsaved changes to a document', async () => {
    const { f, user } = setup(profileWith((p) => { p.documents = [doc(1)]; }));
    const row = (await screen.findByDisplayValue('Zeugnis 1')).closest('.document-row') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Discard changes' })).toBeNull();
    await user.type(within(row).getByLabelText('Name'), ' neu');
    await user.click(within(row).getByLabelText('Attach to every application'));
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled();
    await user.click(within(row).getByRole('button', { name: 'Discard changes' }));
    expect(within(row).getByLabelText('Name')).toHaveValue('Zeugnis 1');
    expect(within(row).getByLabelText('Attach to every application')).not.toBeChecked();
    expect(within(row).queryByRole('button', { name: 'Discard changes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
    expect(f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')).toEqual([]);
  });
});
