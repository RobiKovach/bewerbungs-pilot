import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PreviewFrame, A4_PX } from './PreviewFrame';

describe('PreviewFrame', () => {
  it('scales the A4-wide page to the wrapper width (no horizontal scroll)', () => {
    let cb: ResizeObserverCallback = () => {};
    vi.stubGlobal('ResizeObserver', class { constructor(c: ResizeObserverCallback) { cb = c; } observe() {} disconnect() {} });
    render(<PreviewFrame id="a1" kind="cv" version="v" title="Preview" />);
    act(() => cb([{ contentRect: { width: 397, height: 600 } } as ResizeObserverEntry], {} as ResizeObserver));
    const frame = screen.getByTitle('Preview');
    expect(frame.style.width).toBe(`${A4_PX}px`);
    expect(frame.style.transform).toBe(`scale(${397 / A4_PX})`);
    expect(frame).toHaveAttribute('sandbox', '');
    vi.unstubAllGlobals();
  });
});
