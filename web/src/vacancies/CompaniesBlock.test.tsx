import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../test/fetchMock';
import type { CompanyView } from '../types';
import { CompaniesBlock } from './CompaniesBlock';

const acme: CompanyView = {
  id: 'c1', name: 'Acme GmbH', service: 'lever', account: 'acme', host: 'api.lever.co', addedAt: '2026-11-24T08:00:00.000Z',
  lastReadAt: '2026-11-24T09:00:00.000Z', lastReadFailed: false, url: 'https://jobs.lever.co/acme', offers: 4,
};

describe('CompaniesBlock', () => {
  it('lists the followed companies, adds one with its name and removes one', async () => {
    let list: CompanyView[] = [acme];
    const sent: unknown[] = [];
    mockFetch({
      'GET /api/companies': () => ({ body: { companies: list } }),
      'POST /api/companies': (init) => {
        sent.push(JSON.parse(String(init?.body)));
        list = [...list, { ...acme, id: 'c2', name: 'Beta AG', service: 'personio', account: 'beta', offers: 2 }];
        return { body: { companies: list } };
      },
      'DELETE /api/companies/c1': () => { list = list.filter((c) => c.id !== 'c1'); return { body: { companies: list } }; },
    });
    render(<CompaniesBlock disabled={false} />);
    expect(await screen.findByText('Acme GmbH')).toBeInTheDocument();
    expect(screen.getByText(/Offers: 4/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Careers page' })).toHaveAttribute('href', 'https://jobs.lever.co/acme');
    const add = screen.getByRole('button', { name: 'Follow company' });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Link to the careers page'), 'https://beta.jobs.personio.de');
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Company name (for the letter)'), 'Beta AG');
    await userEvent.click(add);
    expect(await screen.findByText('Beta AG')).toBeInTheDocument();
    expect(sent).toEqual([{ url: 'https://beta.jobs.personio.de', name: 'Beta AG' }]);
    expect(screen.getByLabelText('Link to the careers page')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Stop following Acme GmbH' }));
    expect(await screen.findByText('Beta AG')).toBeInTheDocument();
    expect(screen.queryByText('Acme GmbH')).toBeNull();
  });

  it('a link that is no supported careers page keeps what was typed and says why', async () => {
    mockFetch({
      'GET /api/companies': () => ({ body: { companies: [] } }),
      'POST /api/companies': () => ({ status: 400, body: { error: { code: 'BAD_REQUEST', reason: 'companyLink', detailsForLog: '' } } }),
    });
    render(<CompaniesBlock disabled={false} />);
    expect(await screen.findByText('You do not follow any company yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Link to the careers page'), 'https://www.acme.example/jobs');
    await userEvent.type(screen.getByLabelText('Company name (for the letter)'), 'Acme');
    await userEvent.click(screen.getByRole('button', { name: 'Follow company' }));
    expect(await screen.findByText('BewerbungsPilot cannot read this careers page.')).toBeInTheDocument();
    expect(screen.getByLabelText('Link to the careers page')).toHaveValue('https://www.acme.example/jobs');
  });

  it('a failed last read is shown; with 20 companies there is no add form', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...acme, id: `c${i}`, name: `Firma ${i}`, lastReadFailed: i === 0 }));
    mockFetch({ 'GET /api/companies': () => ({ body: { companies: many } }) });
    render(<CompaniesBlock disabled={false} />);
    expect(await screen.findByText(/The last read failed/)).toBeInTheDocument();
    expect(screen.getByText(/You follow 20 companies/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Follow company' })).toBeNull();
  });
});
