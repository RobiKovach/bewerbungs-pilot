import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PackageReadiness, Vacancy } from '../types';
import { CreatePackageDialog } from './CreatePackageDialog';

export const READINESS_NOTE_ID = 'package-readiness-note';

/** `readiness` is fetched once by the page; null (not loaded or failed) keeps the button usable, the dialog checks again. */
export function PackageButton({ vacancy, existingId, readiness, pollMs }: { vacancy: Vacancy; existingId: string | null; readiness: PackageReadiness | null; pollMs?: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (existingId) return <div className="btn-row"><a className="btn" href={`#/applications/${existingId}`}>{t('applications.open')}</a></div>;
  if (open) return <CreatePackageDialog vacancy={vacancy} onClose={() => setOpen(false)} pollMs={pollMs} />;
  if (readiness && !readiness.ready) {
    return <div className="btn-row"><button type="button" className="btn" disabled aria-describedby={READINESS_NOTE_ID}>{t('applications.create.button')}</button></div>;
  }
  return <div className="btn-row"><button type="button" className="btn" onClick={() => setOpen(true)}>{t('applications.create.button')}</button></div>;
}
