import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AiHelperCards } from '../../ai/AiHelperCards';
import { useSettings } from '../../settings';
import type { StepProps } from '../steps';

// Step id stays 'claude' in steps.ts so saved onboarding progress keeps working.
export function AiHelperStep({ onNext }: StepProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [ready, setReady] = useState(false);
  const canGoOn = ready || settings.llm.provider !== null;
  return (
    <>
      <p>{t('onboarding.ai.intro')}</p>
      <AiHelperCards onReady={() => setReady(true)} />
      <div className="btn-row">
        <button type="button" className="btn" disabled={!canGoOn} onClick={onNext}>{t('common.next')}</button>
        {!canGoOn ? <button type="button" className="btn ghost" onClick={onNext}>{t('common.continueAnyway')}</button> : null}
      </div>
    </>
  );
}
