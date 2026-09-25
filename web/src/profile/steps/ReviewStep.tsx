import { useTranslation } from 'react-i18next';
import { SECTION_IDS } from '../constants';
import { CvProposalsBanner, sectionAnchor } from '../CvProposal';
import { SectionCard } from '../SectionCard';
import { NextButton } from '../unsaved';
import type { WizardStepProps } from './types';

export function ReviewStep({ onNext, nextLabelKey = 'common.next' }: WizardStepProps) {
  const { t } = useTranslation();
  return (
    <>
      <p>{t('profile.review.intro')}</p>
      <CvProposalsBanner />
      {SECTION_IDS.map((id) => <div key={id} id={sectionAnchor(id)}><SectionCard id={id} /></div>)}
      <NextButton onNext={onNext} labelKey={nextLabelKey} />
    </>
  );
}
