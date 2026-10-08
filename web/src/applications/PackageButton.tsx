import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PackageReadiness, Vacancy } from '../types';
import { CreatePackageDialog } from './CreatePackageDialog';

export const READINESS_NOTE_ID = 'package-readiness-note';

/**
 * `readiness` is fetched once by the page; null (not loaded or failed) keeps the button usable, the dialog checks again.
 * `existing` = the package the vacancy links to: one still being edited is only opened; when all its packages were
 * sent, "Open" shows the newest and a new package can still be created.
 */
export function PackageButton({ vacancy, existing, readiness, pollMs }: {
  vacancy: Vacancy; existing: { id: string; editable: boolean } | null; readiness: PackageReadiness | null; pollMs?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const openLink = existing ? <a className="btn" href={`#/applications/${existing.id}`}>{t('applications.open')}</a> : null;
  if (existing?.editable) return <div className="btn-row">{openLink}</div>;
  if (open) return <CreatePackageDialog vacancy={vacancy} onClose={() => setOpen(false)} pollMs={pollMs} />;
  const createClass = existing ? 'btn ghost' : 'btn';
  if (readiness && !readiness.ready) {
    return <div className="btn-row">{openLink}<button type="button" className={createClass} disabled aria-describedby={READINESS_NOTE_ID}>{t('applications.create.button')}</button></div>;
  }
  return <div className="btn-row">{openLink}<button type="button" className={createClass} onClick={() => setOpen(true)}>{t('applications.create.button')}</button></div>;
}
