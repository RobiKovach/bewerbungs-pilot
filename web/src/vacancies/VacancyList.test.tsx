import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider } from '../settings';
import { mockFetch, type RouteHandler } from '../test/fetchMock';
import { vac, vacancyServer } from '../test/vacancyFixtures';
import { VacanciesPage } from '../pages/VacanciesPage';
import type { Vacancy } from '../types';

function setup(list: Vacancy[], extra: Record<string, RouteHandler> = {}) {
  const server = vacancyServer({ list });
  const statusRoutes = Object.fromEntries(list.map((v) => [`POST /api/vacancies/${v.id}/status`, ((init?: RequestInit) => {
    const { status } = JSON.parse(String(init?.body)) as { status: Vacancy['status'] };
    const updated = { ...v, status, hiddenAt: status === 'hidden' ? '2026-09-28T12:00:00.000Z' : null };
    Object.assign(v, updated);
    return { body: { vacancy: updated } };
  }) as RouteHandler]));
  const f = mockFetch({ ...server.routes, ...statusRoutes, ...extra });
  render(<SettingsProvider><VacanciesPage toastMs={200} /></SettingsProvider>);
  return { f, user: userEvent.setup() };
}
const card = (title: string) => screen.getByRole('heading', { name: title }).closest('article') as HTMLElement;
const findCard = async (title: string) => { await screen.findByRole('heading', { name: title }); return card(title); };

describe('VacancyList', () => {
  it('shows score, why/missing, facts; weak matches folded away', async () => {
    setup([
      vac({ title: 'Stark', score: { value: 86, why: ['React passt'], missing: ['Deutsch C1'], scoredAt: '2026-09-28T10:00:00.000Z' }, locations: ['Dresden'], remote: 'partial', publishedAt: '2026-09-22' }),
      vac({ title: 'Schwach', score: { value: 30, why: [], missing: ['kein Match'], scoredAt: '2026-09-28T10:00:00.000Z' } }),
    ]);
    const strong = (await findCard('Stark'));
    expect(within(strong).getByText('86')).toHaveClass('score--good');
    expect(within(strong).getByText('React passt')).toBeInTheDocument();
    expect(within(strong).getByText('Deutsch C1')).toBeInTheDocument();
    expect(within(strong).getByText(/Dresden · Partly remote · published 22\.09\.2026/)).toBeInTheDocument();
    const weak = screen.getByText('Weak match (1)');
    expect(weak.closest('details')).not.toHaveAttribute('open');
  });

  it('tabs with counts; "Interesting" moves the card to Favourites', async () => {
    const v = vac({ title: 'Gute Stelle' });
    const { user } = setup([v, vac({ status: 'hidden', title: 'Weg' })]);
    await screen.findByRole('heading', { name: 'Gute Stelle' });
    expect(screen.getByRole('tab', { name: 'New 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Hidden 1' })).toBeInTheDocument();
    await user.click(within(card('Gute Stelle')).getByRole('button', { name: '★ Interesting' }));
    expect(await screen.findByRole('tab', { name: 'Favourites 1' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Gute Stelle' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Favourites 1' }));
    expect(within(card('Gute Stelle')).getByRole('button', { name: 'Remove from favourites' })).toBeInTheDocument();
  });

  it('"Not interesting" hides with an undo toast; Undo brings it back', async () => {
    const v = vac({ title: 'Vielleicht' });
    const { user, f } = setup([v]);
    await user.click(within((await findCard('Vielleicht'))).getByRole('button', { name: 'Not interesting' }));
    expect(screen.queryByRole('heading', { name: 'Vielleicht' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('heading', { name: 'Vielleicht' })).toBeInTheDocument();
    const bodies = f.mock.calls.filter((c) => c[0] === `/api/vacancies/${v.id}/status`).map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies).toEqual([{ status: 'hidden' }, { status: 'new' }]);
  });

  it('the toast goes away by itself', async () => {
    const { user } = setup([vac({ title: 'Kurz' })]);
    await user.click(within((await findCard('Kurz'))).getByRole('button', { name: 'Not interesting' }));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('shows the text as plain text, never as HTML', async () => {
    const v = vac({ title: 'Mit Text' });
    const { user } = setup([v], { [`GET /api/vacancies/${v.id}/text`]: () => ({ body: { text: 'Wir suchen <b>Sie</b>!' } }) });
    await user.click(within((await findCard('Mit Text'))).getByRole('button', { name: 'Show text' }));
    const pre = await screen.findByText('Wir suchen <b>Sie</b>!');
    expect(pre.tagName).toBe('PRE');
    expect(pre.querySelector('b')).toBeNull();
  });

  it('missing text of an Arbeitsagentur offer → "Load again"', async () => {
    const v = vac({ title: 'Ohne Text', hasText: false });
    const { user } = setup([v], {
      [`GET /api/vacancies/${v.id}/text`]: () => ({ body: { text: '' } }),
      [`POST /api/vacancies/${v.id}/text/refresh`]: () => ({ body: { vacancy: { ...v, hasText: true } } }),
    });
    const c = (await findCard('Ohne Text'));
    await user.click(within(c).getByRole('button', { name: 'Show text' }));
    await user.click(await within(c).findByRole('button', { name: 'Load again' }));
    expect(await within(c).findByRole('button', { name: 'Hide text' })).toBeInTheDocument();
  });

  it('"Score" for a card that was not scored', async () => {
    const v = vac({ title: 'Offen', scoreState: 'notScored', score: null });
    const { user } = setup([v], { [`POST /api/vacancies/${v.id}/score`]: () => ({ body: { vacancy: { ...v, scoreState: 'scored', score: { value: 77, why: ['ok'], missing: [], scoredAt: '2026-09-28T12:00:00.000Z' } } } }) });
    const c = (await findCard('Offen'));
    expect(within(c).getByText('Not scored yet')).toBeInTheDocument();
    await user.click(within(c).getByRole('button', { name: 'Score' }));
    expect(await within(c).findByText('77')).toBeInTheDocument();
  });

  it('original link opens safely; a non-http link is not shown', async () => {
    setup([vac({ title: 'Link' }), vac({ title: 'Kein Link', url: 'javascript:alert(1)' })]);
    const link = within((await findCard('Link'))).getByRole('link', { name: 'Original ↗' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(card('Kein Link')).queryByRole('link', { name: 'Original ↗' })).toBeNull();
  });

  it('hidden tab: "Bring back"; stale tab: "Remove"', async () => {
    const h = vac({ title: 'Versteckt', status: 'hidden', hiddenAt: '2026-09-28T10:00:00.000Z' });
    const s = vac({ title: 'Alt', status: 'stale' });
    const { user } = setup([h, s]);
    await user.click(await screen.findByRole('tab', { name: 'Hidden 1' }));
    await user.click(within(card('Versteckt')).getByRole('button', { name: 'Bring back' }));
    expect(await screen.findByRole('tab', { name: 'New 1' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Removed by the job board 1' }));
    await user.click(within(card('Alt')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('tab', { name: 'Hidden 1' })).toBeInTheDocument();
  });
});
