import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StatsBlock } from './StatsBlock';
import type { ApplicationStats } from '../types';

const starts = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'];
const stats = (over: Partial<ApplicationStats> = {}): ApplicationStats => ({
  sent: 4, replies: 3, interviews: 1, offers: 1,
  rates: { reply: 0.75, interview: 0.25, offer: 0.25 },
  weeks: starts.map((start, i) => ({ start, count: i === 7 ? 1 : i === 5 ? 3 : 0 })),
  ...over,
});

describe('StatsBlock', () => {
  it('shows the four counts and the three rates under a labelled heading', () => {
    render(<StatsBlock stats={stats()} />);
    const section = screen.getByRole('region', { name: 'Your applications in numbers' });
    expect(within(section).getByText('Sent or submitted').nextSibling).toHaveTextContent('4');
    expect(within(section).getByText('Replies').nextSibling).toHaveTextContent('3');
    expect(within(section).getByText('Interviews').nextSibling).toHaveTextContent('1');
    expect(within(section).getByText('Offers').nextSibling).toHaveTextContent('1');
    expect(within(section).getByText('75%')).toBeInTheDocument();
    expect(within(section).getAllByText('25%')).toHaveLength(2);
  });
  it('shows a dash for each rate when nothing was sent', () => {
    render(<StatsBlock stats={stats({ sent: 0, replies: 0, interviews: 0, offers: 0, rates: null, weeks: starts.map((start) => ({ start, count: 0 })) })} />);
    expect(screen.getAllByText('—')).toHaveLength(3);
  });
  it('draws a chart with a text alternative listing every week, 8 bars and labelled axes', () => {
    const { container } = render(<StatsBlock stats={stats()} />);
    const svg = screen.getByRole('img');
    expect(svg).toHaveAccessibleName('Sent or submitted per week: 17.08. 0, 24.08. 0, 31.08. 0, 07.09. 0, 14.09. 0, 21.09. 3, 28.09. 0, 05.10. 1');
    expect(container.querySelectorAll('rect.stats-bar')).toHaveLength(8);
    const texts = Array.from(svg.querySelectorAll('text')).map((x) => x.textContent);
    for (const label of ['17.08.', '05.10.']) expect(texts).toContain(label);
    expect(texts).toContain('3'); // y-axis maximum (and the bar's value label)
  });
  it('keeps an axis (maximum 1) when every week is zero', () => {
    render(<StatsBlock stats={stats({ weeks: starts.map((start) => ({ start, count: 0 })) })} />);
    const texts = Array.from(screen.getByRole('img').querySelectorAll('text.stats-axis-y')).map((x) => x.textContent);
    expect(texts).toContain('1');
  });
});
