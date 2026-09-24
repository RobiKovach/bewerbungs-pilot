import { useCallback, useState } from 'react';

export type CallState =
  | { kind: 'idle' }
  | { kind: 'running'; controller: AbortController }
  | { kind: 'failed'; error: unknown };

/** For Claude calls the person may cancel: a cancel returns to "idle", never shows an error. */
export function useCancellable() {
  const [state, setState] = useState<CallState>({ kind: 'idle' });

  const run = useCallback(async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    const controller = new AbortController();
    setState({ kind: 'running', controller });
    try {
      const result = await fn(controller.signal);
      setState({ kind: 'idle' });
      return result;
    } catch (err) {
      setState((err as Error).name === 'AbortError' ? { kind: 'idle' } : { kind: 'failed', error: err });
      return undefined;
    }
  }, []);

  const cancel = () => {
    if (state.kind === 'running') state.controller.abort();
  };
  const fail = useCallback((error: unknown) => setState({ kind: 'failed', error }), []);

  return { state, run, cancel, fail };
}
