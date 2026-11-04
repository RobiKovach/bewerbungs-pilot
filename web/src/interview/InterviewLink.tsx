import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { isPrepClosed, isPrepOpen } from './format';
import type { ApplicationStatus } from '../types';

/**
 * The way into the preparation. Sent applications always have it. Closed ones only when a preparation was saved, which
 * only the server knows: a failed question just means no link.
 */
export function InterviewLink({ id, status, className }: { id: string; status: ApplicationStatus; className?: string }) {
  const { t } = useTranslation();
  const closed = isPrepClosed(status);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!closed) return;
    let current = true;
    api.interview(id).then((v) => { if (current) setSaved(v.prep !== null); }).catch(() => { if (current) setSaved(false); });
    return () => { current = false; };
  }, [id, closed]);
  if (!isPrepOpen(status) && !(closed && saved)) return null;
  return <a className={className} href={`#/applications/${id}/interview`}>{t('interview.title')}</a>;
}
