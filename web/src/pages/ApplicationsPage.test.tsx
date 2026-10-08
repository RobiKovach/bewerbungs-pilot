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
});
