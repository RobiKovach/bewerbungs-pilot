import { useCallback, useRef, useState } from 'react';

/** After this many failed polls in a row the person is told the app does not answer. */
export const LOST_AFTER = 3;

/**
 * Counts failed reads of a watched state. `lost` turns on after LOST_AFTER failures in a row (or when the very first
 * read fails) and off with the next answer.
 */
export function usePollHealth() {
  const fails = useRef(0);
  const [lost, setLost] = useState(false);
  const ok = useCallback(() => { fails.current = 0; setLost(false); }, []);
  const failed = useCallback((first = false) => {
    fails.current += 1;
    if (first || fails.current >= LOST_AFTER) setLost(true);
  }, []);
  return { lost, ok, failed };
}
