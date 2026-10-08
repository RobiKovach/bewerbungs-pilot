import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { ErrorBanner } from '../../components/ErrorBanner';
import { MailWizard } from '../../mail/MailWizard';
import type { MailSettingsView } from '../../types';
import type { StepProps } from '../steps';

export function EmailStep({ onNext }: StepProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<MailSettingsView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getMail().then((v) => { if (alive) setView(v); }, (err: unknown) => { if (alive) setError(err); });
    return () => { alive = false; };
  }, []);

  if (!view) return error ? <ErrorBanner error={error} /> : <p className="muted">{t('common.loading')}</p>;

  if (saved || (view.mail && view.passwordSaved)) {
    return (
      <>
        <p className="ok">{saved ? t('mail.done') : t('mail.connectedAs', { address: view.mail?.address ?? '' })}</p>
        <div className="btn-row"><button type="button" className="btn" onClick={onNext}>{t('common.next')}</button></div>
      </>
    );
  }
  return (
    <>
      <p>{t('onboarding.email.body')}</p>
      <MailWizard initial={view} onSaved={(v) => { setView(v); setSaved(true); }} />
      <div className="btn-row"><button type="button" className="btn ghost" onClick={onNext}>{t('mail.skip')}</button></div>
    </>
  );
}
