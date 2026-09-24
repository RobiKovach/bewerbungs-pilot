import { useTranslation } from 'react-i18next';
import { SECTION_IDS } from '../constants';
import { SectionCard } from '../SectionCard';
import type { WizardStepProps } from './types';

export function ReviewStep({ onNext, nextLabelKey = 'common.next' }: WizardStepProps) {
  const { t } = useTranslation();
  return (
    <>
      <p>{t('profile.review.intro')}</p>
      {SECTION_IDS.map((id) => <SectionCard key={id} id={id} />)}
      <div className="btn-row"><button type="button" className="btn" onClick={onNext}>{t(nextLabelKey)}</button></div>
    </>
  );
}
