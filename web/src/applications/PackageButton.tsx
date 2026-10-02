import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { PackageReadiness, Vacancy } from '../types';
import { CreatePackageDialog, MissingList } from './CreatePackageDialog';

export function PackageButton({ vacancy, existingId, pollMs }: { vacancy: Vacancy; existingId: string | null; pollMs?: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [readiness, setReadiness] = useState<PackageReadiness | null>(null);
  useEffect(() => {
    if (existingId) return undefined;
    let alive = true;
    // If the check fails the button stays usable: the dialog checks again.
    api.packageReadiness().then((r) => { if (alive) setReadiness(r); }, () => undefined);
    return () => { alive = false; };
  }, [existingId]);
  if (existingId) return <div className="btn-row"><a className="btn" href={`#/applications/${existingId}`}>{t('applications.open')}</a></div>;
  if (open) return <CreatePackageDialog vacancy={vacancy} onClose={() => setOpen(false)} pollMs={pollMs} />;
  if (readiness && !readiness.ready) {
    return (
      <div className="create-package__blocked">
        <div className="btn-row"><button type="button" className="btn" disabled>{t('applications.create.button')}</button></div>
        <MissingList readiness={readiness} />
      </div>
    );
  }
  return <div className="btn-row"><button type="button" className="btn" onClick={() => setOpen(true)}>{t('applications.create.button')}</button></div>;
}
