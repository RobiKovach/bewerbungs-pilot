import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { usePollHealth } from '../pollHealth';
import type { SearchState } from '../types';

export interface SearchStatus {
  state: SearchState | null;
  startError: unknown;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** The app stopped answering (several failed reads in a row, or the first one). */
  lost: boolean;
  /** Read the state again now (the "Check again" button). */
  recheck: () => void;
}

/** Reads the state once; while it is "running" polls every `pollMs` and calls `onTick` (reload the list) after each poll and once more at the end. */
export function useSearchStatus({ onTick, pollMs = 2000 }: { onTick: () => void; pollMs?: number }): SearchStatus {
  const [state, setState] = useState<SearchState | null>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const tick = useRef(onTick);
  tick.current = onTick;
  const health = usePollHealth();
  const { ok, failed } = health;

  const read = useCallback((first: boolean) => api.searchState().then((s) => { ok(); return s; }, () => { failed(first); return null; }), [ok, failed]);

  useEffect(() => {
    let alive = true;
    void read(true).then((s) => { if (alive && s) setState(s); });
    return () => { alive = false; };
  }, [read]);

  const running = state?.state === 'running';
  useEffect(() => {
    if (!running) return undefined;
    let alive = true;
    const timer = setInterval(() => {
      void read(false).then((s) => {
        if (!alive || !s) return;
        setState(s);
        tick.current();
      });
    }, pollMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [running, pollMs, read]);

  // One last reload when a run ends, so the final scores are on screen.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) tick.current();
    wasRunning.current = running;
  }, [running]);

  const start = useCallback(async () => {
    setStartError(null);
    try {
      setState(await api.startSearch());
    } catch (err) {
      setStartError(err);
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      setState(await api.stopSearch());
    } catch (err) {
      setStartError(err);
    }
  }, []);

  const recheck = useCallback(() => { void read(false).then((s) => { if (s) setState(s); }); }, [read]);

  return { state, startError, start, stop, lost: health.lost, recheck };
}
