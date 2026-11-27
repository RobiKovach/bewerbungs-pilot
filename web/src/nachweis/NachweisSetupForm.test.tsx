import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NachweisSetupForm } from './NachweisSetupForm';
import { mockFetch } from '../test/fetchMock';
import { profileWith, viewOf } from '../test/profileFixtures';
import type { NachweisSetup } from '../types';

afterEach(() => { vi.unstubAllGlobals(); });

const saved = (setup: NachweisSetup | null) => viewOf(profileWith((p) => { p.nachweis = setup; }));
const bodyOf = (fetchFn: ReturnType<typeof mockFetch>, key: string) => {
  const call = fetchFn.mock.calls.find(([url, init]) => `${init?.method ?? 'GET'} ${url}` === key);
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
};
const standardSetup = (over: Partial<NachweisSetup> = {}): NachweisSetup => ({
  audience: 'measure', personName: 'Max Muster', measure: { provider: 'Träger', name: 'Kurs', entry: '', exit: '', advisor: '' },
  office: null, blank: { kind: 'standard' }, updatedAt: '2026-11-27T10:00:00.000Z', ...over,
});

describe('NachweisSetupForm', () => {
  it('shows measure fields by default and office fields after choosing Jobcenter', async () => {
    render(<NachweisSetupForm initial={null} personName="Max Muster" onSaved={() => {}} />);
    expect(screen.getByLabelText('Name on the form')).toHaveValue('Max Muster');
    expect(screen.getByLabelText('Provider (Träger)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Customer / BG number')).toBeNull();
    await userEvent.click(screen.getByLabelText('Jobcenter'));
    expect(screen.getByLabelText('Customer / BG number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Provider (Träger)')).toBeNull();
  });

  it('own form option hidden for Jobcenter', async () => {
    render(<NachweisSetupForm initial={null} personName="" onSaved={() => {}} />);
    expect(screen.getByLabelText('My own form')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Jobcenter'));
    expect(screen.queryByLabelText('My own form')).toBeNull();
  });

  it('upload error NACHWEIS_FORM_UNKNOWN shows the translated text and keeps standard', async () => {
    const onSaved = vi.fn();
    const onApply = vi.fn();
    mockFetch({
      'PUT /api/profile/nachweis': () => ({ body: saved(standardSetup()) }),
      'POST /api/profile/nachweis/blank': () => ({ status: 400, body: { error: { code: 'NACHWEIS_FORM_UNKNOWN', detailsForLog: 'x' } } }),
    });
    render(<NachweisSetupForm initial={null} personName="Max Muster" onSaved={onSaved} onApply={onApply} />);
    await userEvent.type(screen.getByLabelText('Provider (Träger)'), 'Träger');
    await userEvent.click(screen.getByLabelText('My own form'));
    const file = new File(['x'], 'cv.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    await userEvent.upload(screen.getByLabelText('Choose the Word file (.docx)'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This Word file is not a form the app knows.')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledWith(saved(standardSetup()));
    expect(screen.getByLabelText('Standard form of the app')).toBeChecked();
  });

  it('save calls saveSetup with measure null for Agentur', async () => {
    const onSaved = vi.fn();
    const result = saved(standardSetup({ audience: 'agentur', measure: null, office: { name: 'Agentur Dresden', customerNumber: '', advisor: '' } }));
    const fetchFn = mockFetch({ 'PUT /api/profile/nachweis': () => ({ body: result }) });
    render(<NachweisSetupForm initial={null} personName="Max Muster" onSaved={onSaved} />);
    await userEvent.click(screen.getByLabelText('Agentur für Arbeit'));
    await userEvent.type(screen.getByLabelText('Office'), 'Agentur Dresden');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(result));
    expect(bodyOf(fetchFn, 'PUT /api/profile/nachweis')).toEqual({
      audience: 'agentur', personName: 'Max Muster', measure: null, office: { name: 'Agentur Dresden', customerNumber: '', advisor: '' },
    });
  });

  it('switching an own form back to standard removes it after saving', async () => {
    const own = standardSetup({ blank: { kind: 'own', form: 'bbw-qgz-pp018', file: { id: 'f1', ext: '.docx', originalName: 'Bogen.docx', size: 1, uploadedAt: '2026-11-27T10:00:00.000Z' } } });
    const fetchFn = mockFetch({
      'PUT /api/profile/nachweis': () => ({ body: saved(own) }),
      'DELETE /api/profile/nachweis/blank': () => ({ body: saved(standardSetup()) }),
    });
    const onSaved = vi.fn();
    render(<NachweisSetupForm initial={own} personName="" onSaved={onSaved} />);
    expect(screen.getByText('bbw form recognised: Bogen.docx')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Standard form of the app'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved(standardSetup())));
    expect(fetchFn.mock.calls.some(([url, init]) => url === '/api/profile/nachweis/blank' && init?.method === 'DELETE')).toBe(true);
  });
});
