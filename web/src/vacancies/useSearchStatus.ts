import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { SearchState } from '../types';

export interface SearchStatus {
  state: SearchState | null;
  startError: unknown;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/** Reads the state once; while it is "running" polls every `pollMs` and calls `onTick` (reload the list) after each poll and once more at the end. */
export function useSearchStatus({ onTick, pollMs = 2000 }: { onTick: () => void; pollMs?: number }): SearchStatus {
  const [state, setState] = useState<SearchState | null>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const tick = useRef(onTick);
  tick.current = onTick;

  useEffect(() => {
    let alive = true;
    api.searchState().then((s) => { if (alive) setState(s); }, () => undefined);
    return () => { alive = false; };
  }, []);

  const running = state?.state === 'running';
  useEffect(() => {
    if (!running) return undefined;
    let alive = true;
    const timer = setInterval(() => {
      api.searchState().then((s) => {
        if (!alive) return;
        setState(s);
        tick.current();
      }, () => undefined);
    }, pollMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [running, pollMs]);

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

  return { state, startError, start, stop };
}
