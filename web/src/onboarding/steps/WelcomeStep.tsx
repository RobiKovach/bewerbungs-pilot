import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import type { StepProps } from '../steps';

export function WelcomeStep({ onNext }: StepProps) {
  const { t } = useTranslation();
  return (
    <>
      <p>{t('onboarding.welcome.body')}</p>
      <div className="welcome-lang"><LanguageSwitcher /></div>
      <div className="btn-row"><button type="button" className="btn" onClick={onNext}>{t('common.next')}</button></div>
    </>
  );
}
