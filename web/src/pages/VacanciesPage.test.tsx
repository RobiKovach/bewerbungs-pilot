import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { mockFetch } from '../test/fetchMock';
import { emptyProfile } from '../test/profileFixtures';
import { readyProfile, vac, vacancyServer } from '../test/vacancyFixtures';
import { viewOf } from '../test/profileFixtures';
import type { WishesData } from '../types';
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

  it('lists cards it got from the server (titles only here; cards are tested in Task 12)', async () => {
    mockFetch(vacancyServer({ list: [vac({ title: 'Frontend Developer (m/w/d)' })] }).routes);
    renderPage();
    expect(await screen.findByText('Frontend Developer (m/w/d)')).toBeInTheDocument();
  });
});
