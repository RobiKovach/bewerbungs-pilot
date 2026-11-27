import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../api';
import { mockFetch } from '../test/fetchMock';
import { profileWith, viewOf } from '../test/profileFixtures';
import type { NachweisCandidate, NachweisSetup, NachweisView } from '../types';
import { NachweisDialog } from './NachweisDialog';

const saveFile = vi.hoisted(() => vi.fn());
vi.mock('../files/save', () => ({ saveFile }));

const setup: NachweisSetup = {
  audience: 'jobcenter', personName: 'Max Muster', measure: null, office: { name: 'Jobcenter Dresden', customerNumber: '', advisor: '' },
  blank: { kind: 'standard' }, updatedAt: '2026-11-27T10:00:00.000Z',
};
const cand = (id: string, at: string, over: Partial<NachweisCandidate> = {}): NachweisCandidate =>
  ({ packageId: id, company: `Firma ${id}`, title: `Stelle ${id}`, appliedAt: at, exportedAt: null, contactUnconfirmed: false, ...over });
const VIEW: NachweisView = {
  setup,
  candidates: [
    cand('a1', '2026-11-03T10:00:00.000Z'),
    cand('a2', '2026-11-05T10:00:00.000Z', { exportedAt: '2026-11-20T10:00:00.000Z' }),
    cand('a3', '2026-11-10T10:00:00.000Z', { contactUnconfirmed: true }),
  ],
};
let fetchFn: ReturnType<typeof mockFetch>;
const routes = (view: NachweisView = VIEW) => ({
  'GET /api/nachweis': () => ({ body: view }),
  'POST /api/nachweis/mark': () => ({ body: view }),
  'GET /api/profile': () => ({ body: viewOf(profileWith((p) => { p.sections.personal.data.fullName = 'Max Muster'; })) }),
});
const markBodies = () => fetchFn.mock.calls.filter(([url]) => url === '/api/nachweis/mark').map(([, init]) => JSON.parse(String(init?.body)));
const box = (name: RegExp) => screen.getByRole('checkbox', { name });

beforeEach(() => { saveFile.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('NachweisDialog', () => {
  it('ticks only not exported candidates', async () => {
    fetchFn = mockFetch(routes());
    render(<NachweisDialog onClose={() => {}} />);
    expect(await screen.findByRole('checkbox', { name: /Firma a1/ })).toBeChecked();
    expect(box(/Firma a3/)).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Firma a2/ })).toBeNull();
    expect(screen.getByText('Applications: 2 · Pages: 1')).toBeInTheDocument();
  });

  it('toggle shows exported ones unticked with date', async () => {
    fetchFn = mockFetch(routes());
    render(<NachweisDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Show already exported' }));
    expect(box(/Firma a2/)).not.toBeChecked();
    expect(screen.getByText('in Nachweis on 20.11.2026')).toBeInTheDocument();
  });

  it('an exported row ticked and then hidden again is not saved', async () => {
    fetchFn = mockFetch(routes());
    saveFile.mockResolvedValue('saved');
    render(<NachweisDialog onClose={() => {}} />);
    const toggle = await screen.findByRole('checkbox', { name: 'Show already exported' });
    await userEvent.click(toggle);
    await userEvent.click(box(/Firma a2/));
    expect(screen.getByText('Applications: 3 · Pages: 1')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByText('Applications: 2 · Pages: 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save as…' }));
    await waitFor(() => expect(markBodies()).toHaveLength(1));
    expect(markBodies()[0].applicationIds).toEqual(['a1', 'a3']);
  });

  it('saved → mark called once with the ticked ids and the file name', async () => {
    fetchFn = mockFetch(routes());
    saveFile.mockResolvedValue('saved');
    const onChanged = vi.fn();
    render(<NachweisDialog onClose={() => {}} onChanged={onChanged} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save as…' }));
    expect(await screen.findByText('Saved. These applications are now marked as in the Nachweis.')).toBeInTheDocument();
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0][0]).toMatchObject({ kind: 'docx', suggestedName: 'Bewerbungsnachweis_03.11.2026_10.11.2026.docx' });
    expect(markBodies()).toEqual([{ applicationIds: ['a1', 'a3'], fileName: 'Bewerbungsnachweis_03.11.2026_10.11.2026.docx' }]);
    expect(onChanged).toHaveBeenCalled();
  });

  it('cancelled → mark not called', async () => {
    fetchFn = mockFetch(routes());
    saveFile.mockResolvedValue('cancelled');
    render(<NachweisDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save as…' }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(markBodies()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Save as…' })).toBeEnabled();
  });

  it('save throws FILE_SAVE_FAILED → mark not called, error shown', async () => {
    fetchFn = mockFetch(routes());
    saveFile.mockRejectedValue(new ApiError('FILE_SAVE_FAILED', 'disk'));
    render(<NachweisDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save as…' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(markBodies()).toEqual([]);
  });

  it('double click on save → saveFile called once', async () => {
    fetchFn = mockFetch(routes());
    let finish: (v: string) => void = () => {};
    saveFile.mockImplementation(() => new Promise((r) => { finish = r; }));
    render(<NachweisDialog onClose={() => {}} />);
    const btn = await screen.findByRole('button', { name: 'Save as…' });
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(saveFile).toHaveBeenCalledTimes(1);
    finish('cancelled');
  });

  it('unconfirmed contact line appears only when a ticked candidate has contactUnconfirmed', async () => {
    fetchFn = mockFetch(routes());
    render(<NachweisDialog onClose={() => {}} />);
    expect(await screen.findByText(/contact found automatically and not checked yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Firma a3' })).toHaveAttribute('href', '#/applications/a3');
    await userEvent.click(box(/Firma a3/));
    expect(screen.queryByText(/contact found automatically and not checked yet/)).toBeNull();
  });

  it('nothing new → says so and offers the toggle', async () => {
    fetchFn = mockFetch(routes({ setup, candidates: [cand('a2', '2026-11-05T10:00:00.000Z', { exportedAt: '2026-11-20T10:00:00.000Z' })] }));
    render(<NachweisDialog onClose={() => {}} />);
    expect(await screen.findByText('Nothing new since the last Bewerbungsnachweis.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as…' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Show already exported' })).toBeInTheDocument();
  });

  it('without setup the setup form is shown first', async () => {
    fetchFn = mockFetch({ ...routes({ setup: null, candidates: VIEW.candidates }), 'PUT /api/profile/nachweis': () => ({ body: viewOf(profileWith((p) => { p.nachweis = setup; })) }) });
    // The profile answers after the Nachweis view: the name must still be prefilled.
    const inner = fetchFn.getMockImplementation()!;
    fetchFn.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/profile') await new Promise((r) => setTimeout(r, 50));
      return inner(url, init);
    });
    render(<NachweisDialog onClose={() => {}} />);
    expect(await screen.findByLabelText('Name on the form')).toHaveValue('Max Muster');
    expect(screen.queryByRole('button', { name: 'Save as…' })).toBeNull();
    await userEvent.click(screen.getByLabelText('Jobcenter'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Save as…' })).toBeInTheDocument();
  });
});
