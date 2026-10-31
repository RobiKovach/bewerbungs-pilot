import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { TryDemoButton } from '../../components/TryDemoButton';
import type { StepProps } from '../steps';

export function WelcomeStep({ onNext }: StepProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);

  return (
    <>
      <p>{t('onboarding.welcome.body')}</p>
      <div className="welcome-lang"><LanguageSwitcher /></div>
      <div className="btn-row"><button type="button" className="btn" onClick={onNext}>{t('common.next')}</button></div>
      <div className="demo-offer">
        <p>{t('onboarding.welcome.demo')}</p>
        <TryDemoButton onOpened={() => setOpened(true)} />
        {opened ? <p className="muted" role="status">{t('onboarding.welcome.demoOpened')}</p> : null}
      </div>
    </>
  );
}
