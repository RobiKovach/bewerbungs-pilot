import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { appView, jobState } from '../test/applicationFixtures';
import { ApplicationsPage } from '../pages/ApplicationsPage';
import type { ApplicationView } from '../types';
import { download } from './download';

vi.mock('./download', () => ({ download: vi.fn(async () => undefined) }));

const DOC = { id: '11111111-2222-4333-8444-555555555555', label: 'Zeugnis', size: 3 * 1024 * 1024, selected: true, missing: false };

function setup(routes: Record<string, RouteHandler>, view: ApplicationView = appView()) {
  window.location.hash = '#/applications/app1';
  const f = mockFetch({ 'GET /api/applications/app1': () => ({ body: view }), 'GET /api/applications/job': () => ({ body: jobState() }), ...routes });
  render(<ApplicationsPage pollMs={10} />);
  return { f, user: userEvent.setup() };
}

describe('CV tab', () => {
  it('shows the CV preview and saves an edited Profil', async () => {
    const { f, user } = setup({ 'PATCH /api/applications/app1/cv-profil': () => ({ body: appView({}, { updatedAt: '2026-09-29T11:00:00.000Z', cv: { ...appView().application.cv, profil: 'Mein Text.', profilEditedByHand: true } }) }) });
    await user.click(await screen.findByRole('tab', { name: 'CV' }));
    expect(screen.getByTitle('Preview of the CV').getAttribute('src')).toContain('/preview/cv');
    const profil = screen.getByLabelText('Profile (top of the CV)');
    await user.clear(profil);
    await user.type(profil, 'Mein Text.');
    await user.click(screen.getByRole('button', { name: 'Save Profile' }));
    const patch = f.mock.calls.find(([url]) => url === '/api/applications/app1/cv-profil');
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ profil: 'Mein Text.' });
  });
  it('profile changed + Profil edited by hand → asks whether to keep it, then starts "Update CV"', async () => {
    const view = appView({ profileChanged: true }, { cv: { ...appView().application.cv, profilEditedByHand: true } });
    const { f, user } = setup({ 'POST /api/applications/app1/refresh-cv': () => ({ status: 202, body: jobState({ state: 'running', kind: 'refreshCv', applicationId: 'app1' }) }) }, view);
    await user.click(await screen.findByRole('tab', { name: 'CV' }));
    expect(screen.getByText(/Your profile changed after this package was created/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Update CV' }));
    await user.click(screen.getByRole('button', { name: 'Keep my text' }));
    const post = f.mock.calls.find(([url]) => url === '/api/applications/app1/refresh-cv');
    expect(JSON.parse(String(post![1]!.body))).toEqual({ keepProfil: true, keepHeadline: true });
  });
  it('the headline can be edited and saved; unsaved, it switches Approve, other tabs and Update CV off', async () => {
    const saved = appView({}, { updatedAt: '2026-09-29T11:00:00.000Z', cv: { ...appView().application.cv, headline: 'Frontend-Entwickler', headlineEditedByHand: true } });
    const { f, user } = setup({ 'PATCH /api/applications/app1/cv-headline': () => ({ body: saved }) }, appView({ profileChanged: true }));
    await user.click(await screen.findByRole('tab', { name: 'CV' }));
    await user.type(screen.getByLabelText('Job title under your name'), 'Frontend-Entwickler');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update CV' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Attachments' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save Profile' }));
    const patch = f.mock.calls.find(([url]) => url === '/api/applications/app1/cv-headline');
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ headline: 'Frontend-Entwickler' });
    expect(f.mock.calls.some(([url]) => url === '/api/applications/app1/cv-profil')).toBe(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
  });
  it('Update CV asks one question when only the headline was edited by hand and sends both keep flags', async () => {
    const view = appView({ profileChanged: true }, { cv: { ...appView().application.cv, headline: 'Entwickler', headlineEditedByHand: true } });
    const { f, user } = setup({ 'POST /api/applications/app1/refresh-cv': () => ({ status: 202, body: jobState({ state: 'running', kind: 'refreshCv', applicationId: 'app1' }) }) }, view);
    await user.click(await screen.findByRole('tab', { name: 'CV' }));
    await user.click(screen.getByRole('button', { name: 'Update CV' }));
    expect(screen.getByText('Keep the texts you changed yourself (Profil, job title)?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep my text' }));
    const post = f.mock.calls.find(([url]) => url === '/api/applications/app1/refresh-cv');
    expect(JSON.parse(String(post![1]!.body))).toEqual({ keepProfil: true, keepHeadline: true });
  });
  it('unsaved Profil edits count as unsaved: Approve, other tabs and "Update CV" are off until saved', async () => {
    const { user } = setup({}, appView({ profileChanged: true }));
    await user.click(await screen.findByRole('tab', { name: 'CV' }));
    await user.type(screen.getByLabelText('Profile (top of the CV)'), ' Mehr.');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update CV' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Attachments' })).toBeDisabled();
    expect(screen.getByText('Save or discard your changes first.')).toBeInTheDocument();
  });
  it('"Let Claude write it again" starts the update without keeping the text', async () => {
    const view = appView({ profileChanged: true }, { cv: { ...appView().application.cv, profilEditedByHand: true } });
    const { f, user } = setup({ 'POST /api/applications/app1/refresh-cv': () => ({ status: 202, body: jobState({ state: 'running', kind: 'refreshCv', applicationId: 'app1' }) }) }, view);
    await user.click(await screen.findByRole('tab', { name: 'CV' }));
    await user.click(screen.getByRole('button', { name: 'Update CV' }));
    await user.click(screen.getByRole('button', { name: 'Let Claude write it again' }));
    const post = f.mock.calls.find(([url]) => url === '/api/applications/app1/refresh-cv');
    expect(JSON.parse(String(post![1]!.body))).toEqual({ keepProfil: false, keepHeadline: false });
  });
  it('typing into Profil closes the open question', async () => {
    const view = appView({ profileChanged: true }, { cv: { ...appView().application.cv, profilEditedByHand: true } });
    const { user } = setup({}, view);
    await user.click(await screen.findByRole('tab', { name: 'CV' }));
    await user.click(screen.getByRole('button', { name: 'Update CV' }));
    expect(screen.getByRole('button', { name: 'Keep my text' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Profile (top of the CV)'), ' x');
    expect(screen.queryByRole('button', { name: 'Keep my text' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update CV' })).toBeDisabled();
  });
  it('"Update CV" is off while a job on ANOTHER package runs', async () => {
    const { user } = setup({ 'GET /api/applications/job': () => ({ body: jobState({ state: 'running', kind: 'create', applicationId: 'other' }) }) }, appView({ profileChanged: true }));
    await user.click(await screen.findByRole('tab', { name: 'CV' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update CV' })).toBeDisabled());
  });
});

describe('Attachments tab and downloads', () => {
  it('lists documents with sizes, marks missing ones, warns above ~5 MB and saves the choice', async () => {
    const view = appView({ attachments: [DOC, { ...DOC, id: '22222222-2222-4333-8444-555555555555', label: 'Zertifikat', size: 2.5 * 1024 * 1024 }, { id: '33333333-2222-4333-8444-555555555555', label: '', size: 0, selected: true, missing: true }] });
    const { f, user } = setup({ 'PATCH /api/applications/app1/attachments': () => ({ body: view }) }, view);
    await user.click(await screen.findByRole('tab', { name: 'Attachments' }));
    expect(screen.getByLabelText(/Zeugnis/)).toBeChecked();
    expect(screen.getByText('Deleted from your profile — will be left out')).toBeInTheDocument();
    expect(screen.getByText(/more than 5 MB/)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Zertifikat/));
    const patch = f.mock.calls.find(([url]) => url === '/api/applications/app1/attachments');
    expect(JSON.parse(String(patch![1]!.body)).ids).toEqual([DOC.id, '33333333-2222-4333-8444-555555555555']);
  });
  it('download buttons: letter, CV, each chosen attachment, everything as one PDF; errors are shown', async () => {
    const spy = vi.mocked(download);
    const { user } = setup({}, appView({ attachments: [DOC] }));
    const row = await screen.findByRole('group', { name: 'Download' });
    await user.click(within(row).getByRole('button', { name: 'Cover letter (PDF)' }));
    expect(spy).toHaveBeenLastCalledWith('/api/applications/app1/pdf/letter', 'Anschreiben.pdf');
    await user.click(within(row).getByRole('button', { name: 'Zeugnis (PDF)' }));
    expect(spy).toHaveBeenLastCalledWith(`/api/applications/app1/pdf/attachment/${DOC.id}`, 'Zeugnis.pdf');
    spy.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ApiError' }));
    await user.click(within(row).getByRole('button', { name: 'Everything as one PDF' }));
    expect(spy).toHaveBeenLastCalledWith('/api/applications/app1/pdf/bundle', 'Bewerbung.pdf');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
