import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { useIsDemo } from '../../components/DemoBanner';
import { TryDemoButton } from '../../components/TryDemoButton';
import { useOptionalSettings } from '../../settings';
import { TransferImport } from '../../transfer/TransferImport';
import type { StepProps } from '../steps';

export function WelcomeStep({ onNext }: StepProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  // The demo copy has its own data folder: no place for the person's file (Settings hides the card there too).
  const demo = useIsDemo();
  const ctx = useOptionalSettings();
  const shown = ctx?.settings.usage.noticeShown ?? true;
  const update = ctx?.update;
  // The line about the daily report is the notice for new people: no second notice after the steps.
  useEffect(() => {
    if (!shown) void update?.({ usage: { noticeShown: true } }).catch(() => undefined);
  }, [shown, update]);

  return (
    <>
      <p>{t('onboarding.welcome.body')}</p>
      <div className="welcome-lang"><LanguageSwitcher /></div>
      <p className="muted">{t('onboarding.welcome.ping')}</p>
      <div className="btn-row"><button type="button" className="btn" disabled={importing} onClick={onNext}>{t('common.next')}</button></div>
      {demo ? null : importOpen ? (
        <div className="welcome-import"><TransferImport onBusyChange={setImporting} /></div>
      ) : (
        <div className="btn-row"><button type="button" className="btn ghost" onClick={() => setImportOpen(true)}>{t('onboarding.welcome.haveFile')}</button></div>
      )}
      <div className="demo-offer">
        <p>{t('onboarding.welcome.demo')}</p>
        <TryDemoButton onOpened={() => setOpened(true)} />
        {opened ? <p className="muted" role="status">{t('onboarding.welcome.demoOpened')}</p> : null}
      </div>
    </>
  );
}
