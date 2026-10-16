import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../test/fetchMock';
import { appSummary } from '../test/applicationFixtures';
import { ApplicationsPage, applicationIdFromHash } from './ApplicationsPage';

describe('ApplicationsPage — list', () => {
  it('shows every package with company, title, status, language, date and the "profile changed" mark', async () => {
    mockFetch({ 'GET /api/applications': () => ({ body: { applications: [
      appSummary(),
      appSummary({ id: 'app2', vacancyId: 'v2', company: 'Beispiel AG', title: 'Frontend Developer', language: 'en', status: 'approved', updatedAt: '2026-09-30T08:00:00.000Z', profileChanged: true }),
    ] } }) });
    render(<ApplicationsPage />);
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('link', { name: /Muster GmbH — Webentwickler/ })).toHaveAttribute('href', '#/applications/app1');
    expect(within(rows[0]).getByText('Draft')).toBeInTheDocument();
    expect(within(rows[0]).getByText('DE')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Approved')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Profile changed')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Changed 30.09.2026')).toBeInTheDocument();
  });
  it('shows who wrote each package', async () => {
    mockFetch({ 'GET /api/applications': () => ({ body: { applications: [appSummary({ writtenBy: 'chatgpt' })] } }) });
    render(<ApplicationsPage />);
    expect(await screen.findByText('Written by: ChatGPT')).toBeInTheDocument();
  });
  it('empty: explains how to start and links to the job offers', async () => {
    mockFetch({ 'GET /api/applications': () => ({ body: { applications: [] } }) });
    render(<ApplicationsPage />);
    expect(await screen.findByText(/No application packages yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to job offers' })).toHaveAttribute('href', '#/vacancies');
  });
  it('reads the package id from the address', () => {
    expect(applicationIdFromHash('#/applications/app_1-x')).toBe('app_1-x');
    expect(applicationIdFromHash('#/applications')).toBeNull();
    expect(applicationIdFromHash('#/applications/../x')).toBeNull();
  });
});

describe('ApplicationsPage — status filter', () => {
  it('the list filter shows only matching applications and counts them', async () => {
    mockFetch({ 'GET /api/applications': () => ({ body: { applications: [
      appSummary({ id: 'a1', company: 'Alpha GmbH', status: 'sent' }),
      appSummary({ id: 'a2', company: 'Beta GmbH', status: 'submitted' }),
      appSummary({ id: 'a3', company: 'Gamma GmbH', status: 'interview' }),
      appSummary({ id: 'a4', company: 'Delta GmbH', status: 'draft' }),
    ] } }) });
    const user = userEvent.setup();
    render(<ApplicationsPage />);
    const group = await screen.findByRole('radiogroup', { name: 'Filter by status' });
    expect(within(group).getByRole('radio', { name: 'All (4)' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Sent (2)' })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'Offers (0)' })).toBeInTheDocument();
    await user.click(within(group).getByRole('radio', { name: 'Sent (2)' }));
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('link', { name: /Alpha GmbH/ })).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('link', { name: /Beta GmbH/ })).toBeInTheDocument();
    await user.click(within(group).getByRole('radio', { name: 'Offers (0)' }));
    expect(screen.getByText('No applications with this status.')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('a row with a due reminder is marked "Write again" and has its own filter', async () => {
    mockFetch({ 'GET /api/applications': () => ({ body: { applications: [
      appSummary({ id: 'a1', company: 'Alpha GmbH', status: 'sent', followUpDue: true }),
      appSummary({ id: 'a2', company: 'Beta GmbH', status: 'sent' }),
    ] } }) });
    const user = userEvent.setup();
    render(<ApplicationsPage />);
    const group = await screen.findByRole('radiogroup', { name: 'Filter by status' });
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveClass('app-row--due');
    expect(within(rows[0]!).getByText('Write again')).toBeInTheDocument();
    expect(rows[1]).not.toHaveClass('app-row--due');
    expect(within(rows[1]!).queryByText('Write again')).not.toBeInTheDocument();
    await user.click(within(group).getByRole('radio', { name: 'Write again (1)' }));
    const shown = screen.getAllByRole('listitem');
    expect(shown).toHaveLength(1);
    expect(within(shown[0]!).getByRole('link', { name: /Alpha GmbH/ })).toBeInTheDocument();
  });
});

describe('ApplicationsPage — statistics', () => {
  const stats = { sent: 1, replies: 0, interviews: 0, offers: 0, rates: { reply: 0, interview: 0, offer: 0 }, weeks: [{ start: '2026-10-05', count: 1 }] };
  it('shows the statistics block above the filter when the list is not empty', async () => {
    mockFetch({
      'GET /api/applications': () => ({ body: { applications: [appSummary()] } }),
      'GET /api/applications/stats': () => ({ body: stats }),
    });
    render(<ApplicationsPage />);
    expect(await screen.findByRole('region', { name: 'Your applications in numbers' })).toBeInTheDocument();
  });
  it('a failing statistics request hides only the block — the list still shows', async () => {
    mockFetch({
      'GET /api/applications': () => ({ body: { applications: [appSummary()] } }),
      'GET /api/applications/stats': () => ({ status: 500, body: { error: { code: 'INTERNAL' } } }),
    });
    render(<ApplicationsPage />);
    expect(await screen.findAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Your applications in numbers' })).toBeNull();
  });
  it('no statistics block for an empty list', async () => {
    mockFetch({
      'GET /api/applications': () => ({ body: { applications: [] } }),
      'GET /api/applications/stats': () => ({ body: stats }),
    });
    render(<ApplicationsPage />);
    await screen.findByText(/No application packages yet/);
    expect(screen.queryByRole('region', { name: 'Your applications in numbers' })).toBeNull();
  });
});
