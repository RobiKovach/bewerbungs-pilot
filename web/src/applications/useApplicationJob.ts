import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { usePollHealth } from '../pollHealth';
import type { ApplicationJobState } from '../types';

export function jobError(state: ApplicationJobState | null): ApiError | null {
  return state?.state === 'failed' && state.error ? new ApiError(state.error.code, state.error.detailsForLog) : null;
}

/** Reads the package job once; while it runs, polls every `pollMs` and calls `onFinished` when a run it saw running ends. */
export function useApplicationJob({ pollMs = 2000, onFinished }: { pollMs?: number; onFinished?: (s: ApplicationJobState) => void } = {}) {
  const [state, setState] = useState<ApplicationJobState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const health = usePollHealth();
  const { ok, failed } = health;
  const read = useCallback((first: boolean) => api.applicationJob().then((s) => { ok(); return s; }, () => { failed(first); return null; }), [ok, failed]);

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
      void read(false).then((s) => { if (alive && s) setState(s); });
    }, pollMs);
    return () => { alive = false; clearInterval(timer); };
  }, [running, pollMs, read]);

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running && state) finished.current?.(state);
    wasRunning.current = running;
  }, [running, state]);

  const start = useCallback(async (fn: () => Promise<ApplicationJobState>) => {
    setError(null);
    try {
      setState(await fn());
    } catch (err) {
      setError(err);
    }
  }, []);

  const cancel = useCallback(async () => {
    try {
      setState(await api.cancelApplicationJob());
    } catch (err) {
      setError(err);
    }
  }, []);

  /** Read the job again now (the "Check again" button). */
  const recheck = useCallback(() => { void read(false).then((s) => { if (s) setState(s); }); }, [read]);

  return { state, error, start, cancel, lost: health.lost, recheck };
}
