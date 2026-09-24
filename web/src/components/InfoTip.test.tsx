import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InfoTip } from './InfoTip';

describe('InfoTip', () => {
  it('toggles its explanation', async () => {
    render(<InfoTip textKey="info.quit" />);
    const btn = screen.getByRole('button', { name: 'More information' });
    expect(screen.queryByRole('note')).toBeNull();
    await userEvent.setup().click(btn);
    expect(screen.getByRole('note')).toHaveTextContent('Stops BewerbungsPilot on this computer.');
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });
});
