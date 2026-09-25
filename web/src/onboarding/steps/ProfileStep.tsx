import { useTranslation } from 'react-i18next';
import { ProfileProvider, useProfile } from '../../profile/ProfileContext';
import { ProfileWizard } from '../../profile/ProfileWizard';
import type { StepProps } from '../steps';

function Body({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  const { view } = useProfile();
  if (view.profile.wizard.completedAt) {
    return (
      <>
        <p>{t('profile.doneInOnboarding')}</p>
        <div className="btn-row"><button type="button" className="btn" onClick={onNext}>{t('common.next')}</button></div>
      </>
    );
  }
  return (
    <>
      <p>{t('onboarding.profile.body')}</p>
      <ProfileWizard embedded onDone={onNext} />
      <div className="btn-row"><button type="button" className="btn ghost" onClick={onNext}>{t('profile.later')}</button></div>
    </>
  );
}

export function ProfileStep({ onNext }: StepProps) {
  return <ProfileProvider><Body onNext={onNext} /></ProfileProvider>;
}
