import { useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { useProfile } from './ProfileContext';
import { FilesStep } from './steps/FilesStep';
import { ReviewStep } from './steps/ReviewStep';
import { StartStep } from './steps/StartStep';
import { StoriesStep } from './steps/StoriesStep';
import type { WizardStepProps } from './steps/types';

type Step = 1 | 2 | 3 | 4;
const STEPS: { titleKey: string; Component: ComponentType<WizardStepProps> }[] = [
  { titleKey: 'profile.wizard.start', Component: StartStep },
  { titleKey: 'profile.wizard.review', Component: ReviewStep },
  { titleKey: 'profile.wizard.stories', Component: StoriesStep },
  { titleKey: 'profile.wizard.files', Component: FilesStep },
];

/** The 4-step profile wizard. `embedded` = inside the onboarding card (no own card, smaller heading). */
export function ProfileWizard({ onDone, embedded = false }: { onDone?: () => void; embedded?: boolean }) {
  const { t } = useTranslation();
  const { view, apply } = useProfile();
  const [error, setError] = useState<unknown>(null);
  const step = view.profile.wizard.step;
  const { titleKey, Component } = STEPS[step - 1];

  const go = async (next: Step, completed = false) => {
    setError(null);
    try {
      apply(await api.setWizard(next, completed));
      if (completed) onDone?.();
    } catch (err) {
      setError(err);
    }
  };
  const onNext = () => void (step === 4 ? go(4, true) : go((step + 1) as Step));
  const Heading = embedded ? 'h2' : 'h1';

  return (
    <section className={embedded ? 'profile-wizard' : 'card wizard'}>
      <p className="step-counter">{t('common.stepOf', { current: step, total: STEPS.length })}</p>
      <div className="progress" aria-hidden="true"><div className="progress-bar" style={{ width: `${(step / STEPS.length) * 100}%` }} /></div>
      <Heading>{t(titleKey)}</Heading>
      <Component key={step} onNext={onNext} />
      {error ? <ErrorBanner error={error} /> : null}
      {step > 1 ? (
        <div className="btn-row"><button type="button" className="btn ghost" onClick={() => void go((step - 1) as Step)}>{t('common.back')}</button></div>
      ) : null}
    </section>
  );
}
