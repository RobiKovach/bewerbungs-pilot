import { useTranslation } from 'react-i18next';
import type { StepProps } from '../steps';

export function ComingSoonStep({ stepId, onNext }: StepProps) {
  const { t } = useTranslation();
  return (
    <>
      <p>{t(`onboarding.${stepId}.body`)}</p>
      <div className="btn-row"><button type="button" className="btn" onClick={onNext}>{t('common.next')}</button></div>
    </>
  );
}
