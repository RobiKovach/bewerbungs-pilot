import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { GuidePage } from './GuidePage';

describe('GuidePage', () => {
  it('shows all seven stages in order with what/todo texts', () => {
    render(<GuidePage />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(7);
    expect(within(items[0]).getByRole('heading')).toHaveTextContent('Installation');
    expect(within(items[6]).getByRole('heading')).toHaveTextContent('Track your applications');
    expect(within(items[1]).getByText(/Upload your CV/)).toBeInTheDocument();
  });
  it('marks not-yet-available stages as coming soon', () => {
    render(<GuidePage />);
    expect(screen.getAllByText('Coming soon')).toHaveLength(4);
    expect(within(screen.getAllByRole('listitem')[1]).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '#/profile');
  });
  it('the job search stage opens the vacancies page', () => {
    render(<GuidePage />);
    const stage = screen.getByRole('heading', { name: /Job search/ }).closest('li') as HTMLElement;
    expect(within(stage).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '#/vacancies');
    expect(within(stage).queryByText('Coming soon')).toBeNull();
  });
});
