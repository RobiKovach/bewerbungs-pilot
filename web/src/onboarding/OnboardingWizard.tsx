import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBanner } from '../components/ErrorBanner';
import { useSettings } from '../settings';
import type { SettingsPatch } from '../types';
import { ONBOARDING_STEPS } from './steps';

export function OnboardingWizard() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const [error, setError] = useState<unknown>(null);

  const saved = ONBOARDING_STEPS.findIndex((s) => s.id === settings.onboarding.currentStep);
  const index = saved === -1 ? 0 : saved;
  const step = ONBOARDING_STEPS[index];
  const total = ONBOARDING_STEPS.length;
  const isLast = index === total - 1;

  const go = async (patch: NonNullable<SettingsPatch['onboarding']>) => {
    setError(null);
    try { await update({ onboarding: patch }); } catch (err) { setError(err); }
  };
  const next = () => void go(isLast ? { completed: true, currentStep: null } : { currentStep: ONBOARDING_STEPS[index + 1].id });
  const back = () => void go({ currentStep: ONBOARDING_STEPS[index - 1].id });
  const { Component } = step;

  return (
    <section className="card wizard">
      <p className="step-counter">{t('common.stepOf', { current: index + 1, total })}</p>
      <div className="progress" aria-hidden="true">
        <div className="progress-bar" style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>
      <h1>
        {t(step.titleKey)}{' '}
        {step.status === 'coming-soon' ? <span className="badge">{t('common.comingSoon')}</span> : null}
      </h1>
      <Component key={step.id} stepId={step.id} onNext={next} />
      {error ? <ErrorBanner error={error} /> : null}
      {index > 0 ? (
        <div className="btn-row"><button type="button" className="btn ghost" onClick={back}>{t('common.back')}</button></div>
      ) : null}
    </section>
  );
}
