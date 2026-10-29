import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { appSummary } from '../test/applicationFixtures';
import { mockFetch } from '../test/fetchMock';
import { emptyProfile } from '../test/profileFixtures';
import { readyProfile, vac, vacancyServer } from '../test/vacancyFixtures';
import { viewOf } from '../test/profileFixtures';
import type { Vacancy, WishesData } from '../types';
import { VacanciesPage } from './VacanciesPage';

const renderPage = () => render(<SettingsProvider><VacanciesPage /></SettingsProvider>);

describe('VacanciesPage — strip and empty states', () => {
  it('shows what it searches for, built from the profile', async () => {
    mockFetch(vacancyServer().routes);
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Job offers' })).toBeInTheDocument();
    const strip = screen.getByTestId('search-strip');
    expect(strip).toHaveTextContent('Webentwickler');
    expect(strip).toHaveTextContent('Frontend Developer');
    expect(strip).toHaveTextContent('Dresden +30 km');
    expect(strip).toHaveTextContent('Full-time');
    expect(screen.getByRole('link', { name: 'Change in profile' })).toHaveAttribute('href', '#/profile');
  });

  it('incomplete wishes: a banner to the profile and no search button', async () => {
    mockFetch(vacancyServer({ profile: emptyProfile() }).routes);
    renderPage();
    expect(await screen.findByText('To search, add at least one job title and a city (or "remote only") to your job wishes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search now' })).toBeDisabled();
  });

  it('no offers yet: explains what to do', async () => {
    mockFetch(vacancyServer().routes);
    renderPage();
    expect(await screen.findByText(/No job offers yet/)).toBeInTheDocument();
  });

  it('"published within" is saved in the settings', async () => {
    const server = vacancyServer();
    const f = mockFetch(server.routes);
    renderPage();
    const select = await screen.findByRole('combobox', { name: 'Published within' });
    expect(select).toHaveValue('14');
    await userEvent.setup().selectOptions(select, '3');
    const patch = f.mock.calls.find((c) => c[0] === '/api/settings' && (c[1] as RequestInit)?.method === 'PATCH')!;
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toEqual({ vacancies: { publishedWithinDays: 3 } });
  });

  it('0.8.2: job titles are added and removed right in the strip and saved to the profile wishes', async () => {
    const server = vacancyServer();
    const saved: WishesData[] = [];
    const f = mockFetch({
      ...server.routes,
      'PUT /api/profile/sections/wishes': (init?: RequestInit) => {
        const { data } = JSON.parse(String(init?.body)) as { data: WishesData };
        saved.push(data);
        const p = readyProfile();
        p.sections.wishes.data = data;
        return { body: viewOf(p) };
      },
    });
    renderPage();
    const user = userEvent.setup();
    const input = await screen.findByRole('textbox', { name: 'New job title' });
    await user.type(input, '  Softwareentwickler {Enter}');
    expect(saved.at(-1)!.jobTitles).toEqual(['Webentwickler', 'Frontend Developer', 'Softwareentwickler']);
    expect(saved.at(-1)!.locations).toEqual(['Dresden']); // the rest of the wishes is sent unchanged
    expect(await screen.findByRole('button', { name: 'Remove “Softwareentwickler”' })).toBeInTheDocument();
    expect(input).toHaveValue('');
    // The same title again (any case) is not sent twice.
    await user.type(input, 'webentwickler{Enter}');
    expect(saved).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Remove “Webentwickler”' }));
    expect(saved.at(-1)!.jobTitles).toEqual(['Frontend Developer', 'Softwareentwickler']);
    expect(await screen.findByRole('button', { name: 'Remove “Frontend Developer”' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove “Webentwickler”' })).toBeNull();
    expect(f).toHaveBeenCalled();
  });

  it('9b: vacancies with a sent / site-submitted package sit in "Applied" with a dated badge, not in New/Favourites', async () => {
    const sent = vac({ title: 'Sent by mail', status: 'favorite' });
    const site = vac({ title: 'Applied on site' });
    const open = vac({ title: 'Still open', status: 'favorite' });
    mockFetch({
      ...vacancyServer({ list: [sent, site, open] }).routes,
      'GET /api/applications': () => ({ body: { applications: [
        appSummary({ id: 'a1', vacancyId: sent.id, status: 'interview', submitted: { via: 'mail', at: '2026-10-02T09:00:00.000Z' } }),
        appSummary({ id: 'a2', vacancyId: site.id, status: 'submitted', submitted: { via: 'site', at: '2026-10-03T12:00:00.000Z' } }),
        appSummary({ id: 'a3', vacancyId: open.id, status: 'draft' }),
      ] } }),
    });
    renderPage();
    const user = userEvent.setup();
    const applied = await screen.findByRole('tab', { name: 'Applied 2' });
    expect(screen.getByRole('tab', { name: 'New 0' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Favourites 1' })).toBeInTheDocument();
    await user.click(applied);
    const cards = screen.getAllByRole('article');
    expect(cards.map((c) => c.querySelector('h3')?.textContent)).toEqual(['Applied on site', 'Sent by mail']);
    expect(cards[0]).toHaveTextContent('Submitted on the website 03.10.2026');
    expect(cards[1]).toHaveTextContent('Sent 02.10.2026');
    expect(screen.queryByRole('button', { name: /Interesting/ })).toBeNull();
  });

  it('9c: every card in "Applied" opens the package the badge is about, whatever the stored status', async () => {
    const asNew = vac({ title: 'Stored as new' });
    const asStale = vac({ title: 'Stored as stale', status: 'stale' });
    const asFav = vac({ title: 'Stored as favourite', status: 'favorite' });
    mockFetch({
      ...vacancyServer({ list: [asNew, asStale, asFav] }).routes,
      'GET /api/applications': () => ({ body: { applications: [
        appSummary({ id: 'n1', vacancyId: asNew.id, status: 'sent', submitted: { via: 'mail', at: '2026-10-01T09:00:00.000Z' } }),
        appSummary({ id: 's1', vacancyId: asStale.id, status: 'submitted', submitted: { via: 'site', at: '2026-10-02T09:00:00.000Z' } }),
        appSummary({ id: 'f1', vacancyId: asFav.id, status: 'rejected', submitted: { via: 'mail', at: '2026-10-03T09:00:00.000Z' } }),
        appSummary({ id: 'f2', vacancyId: asFav.id, status: 'draft', createdAt: '2026-10-04T09:00:00.000Z' }),
      ] } }),
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Applied 3' }));
    const links = screen.getAllByRole('article').map((c) => [c.querySelector('h3')?.textContent, [...c.querySelectorAll('a')].filter((a) => a.textContent === 'Open package').map((a) => a.getAttribute('href'))]);
    expect(links).toEqual([
      ['Stored as favourite', ['#/applications/f1']],
      ['Stored as stale', ['#/applications/s1']],
      ['Stored as new', ['#/applications/n1']],
    ]);
  });

  it('9c: "Hide" in "Applied" moves the vacancy to Hidden; "Undo" brings it back to Applied', async () => {
    const v = vac({ title: 'Applied once', status: 'favorite' });
    const posted: unknown[] = [];
    mockFetch({
      ...vacancyServer({ list: [v] }).routes,
      'GET /api/applications': () => ({ body: { applications: [
        appSummary({ id: 'a1', vacancyId: v.id, status: 'sent', submitted: { via: 'mail', at: '2026-10-02T09:00:00.000Z' } }),
      ] } }),
      [`POST /api/vacancies/${v.id}/status`]: (init) => {
        const { status } = JSON.parse(String(init?.body)) as { status: Vacancy['status'] };
        posted.push(status);
        return { body: { vacancy: { ...v, status } } };
      },
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Applied 1' }));
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(await screen.findByRole('tab', { name: 'Hidden 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Applied 0' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('tab', { name: 'Applied 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hidden 0' })).toBeInTheDocument();
    expect(posted).toEqual(['hidden', 'new']);
  });

  it('9b: if the applications list does not load, vacancies stay where they are', async () => {
    mockFetch({ ...vacancyServer({ list: [vac({ title: 'Somewhere', status: 'favorite' })] }).routes, 'GET /api/applications': () => ({ status: 500, body: { error: { code: 'INTERNAL' } } }) });
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Favourites 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Applied 0' })).toBeInTheDocument();
  });

  it('lists cards it got from the server (titles only here; cards are tested in Task 12)', async () => {
    mockFetch(vacancyServer({ list: [vac({ title: 'Frontend Developer (m/w/d)' })] }).routes);
    renderPage();
    expect(await screen.findByText('Frontend Developer (m/w/d)')).toBeInTheDocument();
  });
});

describe('VacanciesPage — find contact (0.9.1)', () => {
  it('an Arbeitsagentur favourite has "Find contact"; saving goes to the vacancy and the card shows it; one dialog at a time', async () => {
    const a = vac({ title: 'AA favourite', status: 'favorite', partnerUrl: 'https://partner.example.de/job' });
    const b = vac({ title: 'Other favourite', status: 'favorite' });
    const manual = vac({ title: 'Pasted', status: 'favorite', source: 'manual', sourceId: null, url: '' });
    const f = mockFetch({
      ...vacancyServer({ list: [a, b, manual] }).routes,
      ['PUT /api/vacancies/' + a.id + '/contact']: (init) => ({ body: { vacancy: { ...a, contact: JSON.parse(String(init?.body)) } } }),
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Favourites 3' }));
    const card = (title: string) => screen.getAllByRole('article').find((c) => c.querySelector('h3')?.textContent === title)!;
    expect(card('Pasted').textContent).not.toContain('Find contact');
    await user.click(within(card('AA favourite')).getByRole('button', { name: 'Find contact' }));
    const dialog = await screen.findByRole('dialog', { name: 'Employer contact' });
    expect(within(dialog).getByRole('button', { name: 'Open the offer page' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: "Read the company's page" })).toBeInTheDocument();
    expect(within(card('Other favourite')).getByRole('button', { name: 'Find contact' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Email'), 'hr@example.de');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(f.mock.calls.some(([url, init]) => url === `/api/vacancies/${a.id}/contact` && init?.method === 'PUT')).toBe(true);
    expect(card('AA favourite')).toHaveTextContent('hr@example.de');
    expect(within(card('Other favourite')).getByRole('button', { name: 'Find contact' })).toBeEnabled();
  });
});
