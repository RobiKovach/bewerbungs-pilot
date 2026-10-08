import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryBlock } from './HistoryBlock';
import type { HistoryEntry } from '../types';

const history = [
  { kind: 'approved', at: '2026-10-01T09:00:00.000Z' },
  { kind: 'sent', at: '2026-10-02T09:00:00.000Z', to: 'jobs@muster.example', messageId: 'm1' },
  { kind: 'interview', at: '2026-10-09T09:00:00.000Z', note: 'Montag, 10 Uhr' },
] as HistoryEntry[];

describe('HistoryBlock', () => {
  it('lists entries newest first with date, status, recipient and note', () => {
    render(<HistoryBlock history={history} canUndo={false} onUndo={() => {}} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('09.10.2026')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Interview')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Montag, 10 Uhr')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Sent')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('to jobs@muster.example')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Approved')).toBeInTheDocument();
  });

  it('skips entries whose kind is not a status (later versions add more kinds)', () => {
    render(<HistoryBlock history={[...history, { kind: 'followUp', at: '2026-10-20T09:00:00.000Z' } as unknown as HistoryEntry]} canUndo={false} onUndo={() => {}} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('undo is offered only when canUndo and asks first', async () => {
    const onUndo = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<HistoryBlock history={history} canUndo={false} onUndo={onUndo} />);
    expect(screen.queryByRole('button', { name: 'Undo last change' })).not.toBeInTheDocument();
    rerender(<HistoryBlock history={history} canUndo onUndo={onUndo} />);
    await user.click(screen.getByRole('button', { name: 'Undo last change' }));
    expect(onUndo).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onUndo).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Undo last change' }));
    await user.click(screen.getByRole('button', { name: 'Yes, undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
  });
});
