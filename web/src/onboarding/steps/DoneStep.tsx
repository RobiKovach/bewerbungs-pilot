import { useTranslation } from 'react-i18next';
import type { StepProps } from '../steps';

export function DoneStep({ onNext }: StepProps) {
  const { t } = useTranslation();
  return (
    <>
      <p>{t('onboarding.done.body')}</p>
      <div className="btn-row"><button type="button" className="btn" onClick={onNext}>{t('onboarding.done.finish')}</button></div>
    </>
  );
}
