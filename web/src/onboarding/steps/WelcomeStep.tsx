import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { TryDemoButton } from '../../components/TryDemoButton';
import { useOptionalSettings } from '../../settings';
import type { StepProps } from '../steps';

export function WelcomeStep({ onNext }: StepProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
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
      <div className="btn-row"><button type="button" className="btn" onClick={onNext}>{t('common.next')}</button></div>
      <div className="demo-offer">
        <p>{t('onboarding.welcome.demo')}</p>
        <TryDemoButton onOpened={() => setOpened(true)} />
        {opened ? <p className="muted" role="status">{t('onboarding.welcome.demoOpened')}</p> : null}
      </div>
    </>
  );
}
