import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch } from '../test/fetchMock';
import { vac } from '../test/vacancyFixtures';
import { CompanyBlock } from './CompanyBlock';
import type { CompanyResearch, Vacancy } from '../types';

function research(over: Partial<CompanyResearch> = {}): CompanyResearch {
  return {
    state: 'done', startedAt: '2026-11-20T10:00:00.000Z', finishedAt: '2026-11-20T10:01:00.000Z', provider: 'claude', language: 'en',
    website: 'https://www.muster.example', websiteByPerson: false,
    about: 'Muster GmbH builds web shops for small firms.',
    news: [{ title: 'Muster opens an office in Leipzig', date: '2026-10-02', source: 'LVZ', url: 'https://news.example/muster-leipzig' }],
    newsFailed: false,
    redFlags: [{ id: 'r1', text: 'Short-time work announced in 2026', sourceUrl: 'https://news.example/kurzarbeit' }],
    facts: [{ id: 'f1', text: 'Muster works with TYPO3 and React', sourceUrl: 'https://www.muster.example/about' }],
    sources: [{ url: 'https://www.muster.example/about', kind: 'about' }],
    error: null,
    ...over,
  };
}

function Harness({ initial }: { initial: Vacancy }) {
  const [v, setV] = useState(initial);
  return <CompanyBlock vacancy={v} onChange={setV} pollMs={20} />;
}

const setup = (v: Vacancy, routes: Parameters<typeof mockFetch>[0] = {}) => {
  const f = mockFetch(routes);
  render(<Harness initial={v} />);
  return { f, user: userEvent.setup() };
};
const open = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByText('About the company'));

describe('CompanyBlock', () => {
  it('no research → Research company button calls the API', async () => {
    const v = vac({ id: 'v1', company: 'Muster GmbH' });
    const { f, user } = setup(v, {
      'POST /api/vacancies/v1/research': () => ({ status: 202, body: { vacancy: { ...v, research: research({ state: 'queued', finishedAt: null }) } } }),
      'GET /api/vacancies': () => ({ body: { vacancies: [{ ...v, research: research({ state: 'queued', finishedAt: null }) }] } }),
    });
    await user.click(screen.getByRole('button', { name: 'Research the company' }));
    expect(f).toHaveBeenCalledWith('/api/vacancies/v1/research', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText('Queued for research')).toBeInTheDocument();
  });

  it('running shows progress and Stop', async () => {
    const v = vac({ id: 'v1', company: 'Muster GmbH', research: research({ state: 'running', finishedAt: null }) });
    let polled = 0;
    let now = v;
    const { f, user } = setup(v, {
      'GET /api/vacancies': () => { polled++; return { body: { vacancies: [now] } }; },
      'DELETE /api/vacancies/v1/research': () => { now = { ...v, research: research({ state: 'failed', error: 'UNKNOWN' }) }; return { body: { vacancy: now } }; },
    });
    expect(screen.getByText('Researching the company…')).toBeInTheDocument();
    // The state is asked again while the research runs (every 2 s in the app, 20 ms here).
    await waitFor(() => expect(polled).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(f).toHaveBeenCalledWith('/api/vacancies/v1/research', expect.objectContaining({ method: 'DELETE' }));
    expect(await screen.findByRole('button', { name: 'Research again' })).toBeInTheDocument();
  });

  it('a poll that answers after Stop does not bring "running" back', async () => {
    const v = vac({ id: 'v1', research: research({ state: 'running', finishedAt: null }) });
    const held: Array<() => void> = [];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'DELETE') return json({ vacancy: { ...v, research: research({ state: 'failed', error: 'UNKNOWN' }) } });
      // Every poll waits; they all answer "running" only after Stop has finished.
      return new Promise<Response>((resolve) => held.push(() => resolve(json({ vacancies: [v] }))));
    }));
    render(<Harness initial={v} />);
    const user = userEvent.setup();
    await waitFor(() => expect(held.length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(await screen.findByRole('button', { name: 'Research again' })).toBeInTheDocument();
    held.forEach((answer) => answer());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Researching the company…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Research again' })).toBeInTheDocument();
  });

  it('running → done by polling shows the result', async () => {
    const v = vac({ id: 'v1', company: 'Muster GmbH', research: research({ state: 'running', finishedAt: null }) });
    setup(v, { 'GET /api/vacancies': () => ({ body: { vacancies: [{ ...v, research: research() }] } }) });
    expect(await screen.findByText('About the company')).toBeInTheDocument();
    expect(screen.queryByText('Researching the company…')).toBeNull();
  });

  it('done shows sections, sources as links, Kununu link', async () => {
    const { user } = setup(vac({ id: 'v1', company: 'Muster & Co GmbH', research: research() }));
    await open(user);
    expect(screen.getAllByRole('link', { name: 'www.muster.example ↗' })[0]).toHaveAttribute('href', 'https://www.muster.example');
    expect(screen.getByText('Muster GmbH builds web shops for small firms.')).toBeInTheDocument();
    const news = screen.getByRole('link', { name: 'Muster opens an office in Leipzig' });
    expect(news).toHaveAttribute('href', 'https://news.example/muster-leipzig');
    expect(news.closest('li')).toHaveTextContent('02.10.2026');
    expect(news.closest('li')).toHaveTextContent('LVZ');
    expect(screen.getByText('only for you, not used in the letter')).toBeInTheDocument();
    const flag = screen.getByText('Short-time work announced in 2026').closest('li') as HTMLElement;
    expect(within(flag).getByRole('link', { name: 'news.example ↗' })).toHaveAttribute('href', 'https://news.example/kurzarbeit');
    const kununu = screen.getByRole('link', { name: 'Reviews on Kununu ↗' });
    expect(kununu).toHaveAttribute('href', 'https://www.kununu.com/de/search?q=Muster%20%26%20Co%20GmbH');
    expect(kununu).toHaveAttribute('target', '_blank');
    expect(kununu).toHaveAttribute('rel', 'noopener noreferrer');
    const fact = screen.getByText('Muster works with TYPO3 and React').closest('li') as HTMLElement;
    expect(within(fact).getByRole('link', { name: 'www.muster.example ↗' })).toHaveAttribute('href', 'https://www.muster.example/about');
    expect(screen.getByText(/Researched 20\.11\.2026/)).toBeInTheDocument();
    expect(screen.getByText('Written by: Claude')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Research again' })).toBeInTheDocument();
  });

  it('hiding a fact calls PATCH and greys it out', async () => {
    const v = vac({ id: 'v1', research: research() });
    const { f, user } = setup(v, {
      'PATCH /api/vacancies/v1/research/facts/f1': (init) => {
        const { hidden } = JSON.parse(String(init?.body)) as { hidden: boolean };
        return { body: { vacancy: { ...v, research: research({ facts: [{ ...research().facts[0], ...(hidden ? { hidden: true } : {}) }] }) } } };
      },
    });
    await open(user);
    await user.click(screen.getByRole('button', { name: "Don't use in the letter" }));
    expect(f).toHaveBeenCalledWith('/api/vacancies/v1/research/facts/f1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ hidden: true }) }));
    const fact = (await screen.findByText('Muster works with TYPO3 and React')).closest('li') as HTMLElement;
    expect(fact).toHaveClass('company__point--hidden');
    expect(within(fact).getByText('not used in the letter')).toBeInTheDocument();
    await user.click(within(fact).getByRole('button', { name: 'Use again' }));
    expect(f).toHaveBeenCalledWith('/api/vacancies/v1/research/facts/f1', expect.objectContaining({ body: JSON.stringify({ hidden: false }) }));
  });

  it('website not found → field → PUT website', async () => {
    const v = vac({ id: 'v1', research: research({ website: '' }) });
    const { f, user } = setup(v, {
      'PUT /api/vacancies/v1/research/website': () => ({ status: 202, body: { vacancy: { ...v, research: research({ state: 'queued', website: 'https://muster.example', websiteByPerson: true }) } } }),
      'GET /api/vacancies': () => ({ body: { vacancies: [v] } }),
    });
    await open(user);
    expect(screen.getByText('Website not found.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Company website'), ' https://muster.example ');
    await user.click(screen.getByRole('button', { name: 'Research from this website' }));
    expect(f).toHaveBeenCalledWith('/api/vacancies/v1/research/website', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ url: 'https://muster.example' }) }));
    expect(await screen.findByText('Queued for research')).toBeInTheDocument();
  });

  it('a refused website keeps the typed address', async () => {
    const v = vac({ id: 'v1', research: research({ website: '' }) });
    const { user } = setup(v, {
      'PUT /api/vacancies/v1/research/website': () => ({ status: 400, body: { error: { code: 'BAD_REQUEST', detailsForLog: 'x' } } }),
    });
    await open(user);
    await user.type(screen.getByLabelText('Company website'), 'http://localhost');
    await user.click(screen.getByRole('button', { name: 'Research from this website' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Company website')).toHaveValue('http://localhost');
  });

  it('empty news → nothing notable found', async () => {
    const { user } = setup(vac({ id: 'v1', research: research({ news: [], redFlags: [], facts: [], about: '' }) }));
    await open(user);
    expect(screen.getAllByText('Nothing notable found.')).toHaveLength(4);
  });

  it('news that could not be loaded say so, not "nothing found"', async () => {
    const { user } = setup(vac({ id: 'v1', research: research({ news: [], newsFailed: true }) }));
    await open(user);
    expect(screen.getByText('The news could not be loaded.')).toBeInTheDocument();
  });

  it('news off (not looked up): no news section at all, no "could not be loaded"', async () => {
    const { user } = setup(vac({ id: 'v1', research: research({ news: [], newsFailed: false, newsOff: true, redFlags: [], facts: [], about: '' }) }));
    await open(user);
    expect(screen.queryByText("What's new (about 6 months)")).not.toBeInTheDocument();
    expect(screen.queryByText('The news could not be loaded.')).not.toBeInTheDocument();
    expect(screen.getAllByText('Nothing notable found.')).toHaveLength(3);
  });

  it('failed research offers to research again', async () => {
    const v = vac({ id: 'v1', research: research({ state: 'failed', error: 'UNKNOWN' }) });
    const { f, user } = setup(v, {
      'POST /api/vacancies/v1/research': () => ({ status: 202, body: { vacancy: { ...v, research: research({ state: 'queued' }) } } }),
      'GET /api/vacancies': () => ({ body: { vacancies: [v] } }),
    });
    expect(screen.getByText('The company research did not finish.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Research again' }));
    expect(f).toHaveBeenCalledWith('/api/vacancies/v1/research', expect.objectContaining({ method: 'POST' }));
  });
});
