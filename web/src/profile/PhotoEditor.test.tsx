import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { mockFetch } from '../test/fetchMock';
import { profileWith, viewOf } from '../test/profileFixtures';
import { PhotoEditor } from './PhotoEditor';
import { ProfileProvider } from './ProfileContext';

const cropperProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock('react-easy-crop', () => ({
  default: (p: Record<string, unknown>) => { cropperProps.last = p; return <div data-testid="cropper" />; },
}));

function setup(withPhoto: boolean) {
  const profile = profileWith((p) => {
    if (withPhoto) p.photo = { id: 'ph1', ext: '.jpg', originalName: 'p.jpg', size: 10, uploadedAt: '2026-10-01T10:00:00.000Z' };
  });
  mockFetch({ 'GET /api/profile': () => ({ body: viewOf(profile) }) });
  return render(<ProfileProvider><PhotoEditor /></ProfileProvider>);
}

describe('PhotoEditor', () => {
  it('crops in a circle with a 1:1 aspect', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
    const { container } = setup(false);
    await screen.findByText('Choose a photo (JPG or PNG)');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByTestId('cropper')).toBeInTheDocument();
    expect(cropperProps.last).toMatchObject({ aspect: 1, cropShape: 'round' });
  });
  it('suggests re-cropping an older photo that is not square', async () => {
    setup(true);
    const img = await screen.findByAltText('Your CV photo');
    expect(screen.queryByText(HINT)).toBeNull();
    Object.defineProperty(img, 'naturalWidth', { value: 300 });
    Object.defineProperty(img, 'naturalHeight', { value: 400 });
    fireEvent.load(img);
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });
  it('shows no hint for a square photo', async () => {
    setup(true);
    const img = await screen.findByAltText('Your CV photo');
    Object.defineProperty(img, 'naturalWidth', { value: 400 });
    Object.defineProperty(img, 'naturalHeight', { value: 400 });
    fireEvent.load(img);
    expect(screen.queryByText(HINT)).toBeNull();
  });
});

const HINT = 'Tip: crop your photo again in a circle so it looks its best in the CV.';
