import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PersonalFinding } from '../types';

const PAUSE_MS = 400;

/**
 * Personal data in an email text that is not in the profile, checked by the server a short pause after the last change.
 * Only a hint: a failed check shows nothing and never blocks sending.
 */
export function useTextCheck(id: string, subject: string, body: string): PersonalFinding[] {
  const [warnings, setWarnings] = useState<PersonalFinding[]>([]);
  useEffect(() => {
    if (subject.trim() === '' && body.trim() === '') {
      setWarnings([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.checkText(id, subject, body, controller.signal).then(
        (r) => setWarnings(r.warnings),
        () => { if (!controller.signal.aborted) setWarnings([]); },
      );
    }, PAUSE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [id, subject, body]);
  return warnings;
}
