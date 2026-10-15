import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmLeave, installLeaveGuard, setUnsaved } from './leaveGuard';
import { UnsavedProvider, useReportUnsaved } from './profile/unsaved';

function Form({ dirty }: { dirty: boolean }) {
  useReportUnsaved(dirty);
  return null;
}

/** Fires hashchange like the browser does after the address changed. */
function goTo(hash: string) {
  window.history.replaceState(null, '', hash);
  const e = new HashChangeEvent('hashchange');
  window.dispatchEvent(e);
}

describe('leave guard', () => {
  let uninstall: () => void;
  let later: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    window.history.replaceState(null, '', '#/profile');
    uninstall = installLeaveGuard();
    later = vi.fn();
    window.addEventListener('hashchange', later); // stands for App / ApplicationsPage, registered after the guard
  });
  afterEach(() => {
    window.removeEventListener('hashchange', later);
    uninstall();
    setUnsaved(false);
    vi.restoreAllMocks();
  });

  it('nothing unsaved: pages change without a question', () => {
    const ask = vi.spyOn(window, 'confirm');
    goTo('#/vacancies');
    expect(ask).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('unsaved + "stay": the page does not change and the old address comes back', () => {
    setUnsaved(true);
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    goTo('#/vacancies');
    expect(ask).toHaveBeenCalledWith('Some changes are not saved yet. If you leave now, they will be lost. Leave anyway?');
    expect(later).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/profile');
  });

  it('unsaved + "leave": the page changes', () => {
    setUnsaved(true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    goTo('#/vacancies');
    expect(later).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#/vacancies');
  });

  it('closing the tab with unsaved changes asks the browser to warn', () => {
    const quiet = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);
    setUnsaved(true);
    const warn = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(warn);
    expect(warn.defaultPrevented).toBe(true);
  });

  it('confirmLeave asks only when something is unsaved', () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmLeave()).toBe(true);
    setUnsaved(true);
    expect(confirmLeave()).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe('UnsavedProvider nesting', () => {
  it('a form inside an inner provider (wizard step) is known to the app-wide one', () => {
    const changes: boolean[] = [];
    const onChange = (v: boolean) => changes.push(v);
    const { rerender } = render(<UnsavedProvider onChange={onChange}><UnsavedProvider><Form dirty={false} /></UnsavedProvider></UnsavedProvider>);
    rerender(<UnsavedProvider onChange={onChange}><UnsavedProvider><Form dirty /></UnsavedProvider></UnsavedProvider>);
    expect(changes.at(-1)).toBe(true);
    rerender(<UnsavedProvider onChange={onChange}><UnsavedProvider><Form dirty={false} /></UnsavedProvider></UnsavedProvider>);
    expect(changes.at(-1)).toBe(false);
  });

  it('a form that goes away (saved and closed) stops counting', () => {
    const changes: boolean[] = [];
    const { rerender } = render(<UnsavedProvider onChange={(v) => changes.push(v)}><Form dirty /></UnsavedProvider>);
    expect(changes.at(-1)).toBe(true);
    rerender(<UnsavedProvider onChange={(v) => changes.push(v)}>{null}</UnsavedProvider>);
    expect(changes.at(-1)).toBe(false);
  });
});
