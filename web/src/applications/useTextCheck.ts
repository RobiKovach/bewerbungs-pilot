import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PersonalFinding, UnsavedPackageText } from '../types';

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

/**
 * The editor's warnings: `saved` (from the package view) while nothing is unsaved; with unsaved letter or CV text, the
 * server checks the package as shown, the same short pause after the last change. A failed check keeps the saved warnings.
 */
export function usePackageCheck(id: string, unsaved: UnsavedPackageText | null, saved: PersonalFinding[]): PersonalFinding[] {
  const [checked, setChecked] = useState<PersonalFinding[] | null>(null);
  // One key for "the same text": the object itself is new on every render.
  const key = unsaved ? JSON.stringify(unsaved) : null;
  useEffect(() => {
    if (key === null) {
      setChecked(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.checkPackage(id, JSON.parse(key) as UnsavedPackageText, controller.signal).then(
        (r) => setChecked(r.warnings),
        () => { if (!controller.signal.aborted) setChecked(null); },
      );
    }, PAUSE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [id, key]);
  return key !== null && checked !== null ? checked : saved;
}
