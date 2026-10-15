import { useEffect, useRef } from 'react';
import { ApiError } from '../api';

/** A mail window opens at the bottom of the editor: bring it into view so the person sees what opened. */
export function useScrollIntoView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, []);
  return ref;
}

/** Busy or "sent but not saved": the package itself is fine. Never reload for these. */
const KEEP = new Set(['sentNotSaved', 'packageBusy', 'packageSending']);

/**
 * The server refused because the package is no longer what this window shows (already sent, changed meanwhile,
 * reminder already done): the editor must load the package again, otherwise "Try again" can never work.
 */
export function isStale(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'CONFLICT' && !KEEP.has(err.reason ?? '');
}
