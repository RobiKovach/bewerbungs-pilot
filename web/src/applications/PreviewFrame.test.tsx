import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreviewFrame, A4_PX, FRAME_PX } from './PreviewFrame';

function renderAt(width: number) {
  let cb: ResizeObserverCallback = () => {};
  vi.stubGlobal('ResizeObserver', class { constructor(c: ResizeObserverCallback) { cb = c; } observe() {} disconnect() {} });
  render(<PreviewFrame id="a1" kind="cv" version="v" title="Preview" />);
  act(() => cb([{ contentRect: { width, height: 600 } } as ResizeObserverEntry], {} as ResizeObserver));
  return screen.getByTitle('Preview');
}

describe('PreviewFrame', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the frame is wider than the A4 page by a scrollbar, so a classic vertical scrollbar never pushes the page sideways', () => {
    expect(FRAME_PX - A4_PX).toBeGreaterThanOrEqual(17);
  });

  it('scales the frame (page + scrollbar room) to the wrapper width (no horizontal scroll)', () => {
    const frame = renderAt(397);
    expect(frame.style.width).toBe(`${FRAME_PX}px`);
    expect(frame.style.transform).toBe(`scale(${397 / FRAME_PX})`);
    expect(frame.style.height).toBe(`${Math.round(600 / (397 / FRAME_PX))}px`);
    expect(frame).toHaveAttribute('sandbox', '');
  });

  it('a wide column shows the page at full size', () => {
    const frame = renderAt(1200);
    expect(frame.style.width).toBe(`${FRAME_PX}px`);
    expect(frame.style.transform).toBe('scale(1)');
  });

  it('9b: "Full screen" shows the same sandboxed page unscaled; Esc and "Close" close it and focus goes back', async () => {
    const small = renderAt(397);
    const user = userEvent.setup();
    const open = screen.getByRole('button', { name: 'Full screen' });
    await user.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Preview' });
    const big = screen.getByTitle('Preview (Full screen)');
    expect(big).toHaveAttribute('src', small.getAttribute('src'));
    expect(big).toHaveAttribute('sandbox', '');
    expect(big.style.width).toBe(`${FRAME_PX}px`);
    expect(big.style.transform).toBe('');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(dialog).not.toBeInTheDocument();
    expect(open).toHaveFocus();
    await user.click(open);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(open).toHaveFocus();
  });
});
