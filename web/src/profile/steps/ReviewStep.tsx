import { useTranslation } from 'react-i18next';
import { SECTION_IDS } from '../constants';
import { SectionCard } from '../SectionCard';
import { NextButton } from '../unsaved';
import type { WizardStepProps } from './types';

export function ReviewStep({ onNext, nextLabelKey = 'common.next' }: WizardStepProps) {
  const { t } = useTranslation();
  return (
    <>
      <p>{t('profile.review.intro')}</p>
      {SECTION_IDS.map((id) => <SectionCard key={id} id={id} />)}
      <NextButton onNext={onNext} labelKey={nextLabelKey} />
    </>
  );
}
