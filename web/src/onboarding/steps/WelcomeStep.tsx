import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { ErrorBanner } from '../../components/ErrorBanner';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import type { Language } from '../../types';
import type { StepProps } from '../steps';

export function WelcomeStep({ onNext }: StepProps) {
  const { t, i18n } = useTranslation();
  const [demo, setDemo] = useState<'idle' | 'starting' | 'opened'>('idle');
  const [error, setError] = useState<unknown>(null);

  // The tab is opened right in the click (a tab opened after the answer would be blocked as a pop-up),
  // then sent to the demo; this tab stays on the real setup.
  const tryDemo = async () => {
    setError(null);
    setDemo('starting');
    const tab = window.open('', '_blank');
    try {
      const { url } = await api.startDemo(i18n.language as Language);
      if (tab) tab.location.href = url; else window.location.href = url;
      setDemo('opened');
    } catch (err) {
      tab?.close();
      setError(err);
      setDemo('idle');
    }
  };

  return (
    <>
      <p>{t('onboarding.welcome.body')}</p>
      <div className="welcome-lang"><LanguageSwitcher /></div>
      <div className="btn-row"><button type="button" className="btn" onClick={onNext}>{t('common.next')}</button></div>
      <div className="demo-offer">
        <p>{t('onboarding.welcome.demo')}</p>
        <button type="button" className="btn ghost" disabled={demo === 'starting'} onClick={() => void tryDemo()}>
          {demo === 'starting' ? t('onboarding.welcome.demoStarting') : t('onboarding.welcome.tryDemo')}
        </button>
        {demo === 'opened' ? <p className="muted" role="status">{t('onboarding.welcome.demoOpened')}</p> : null}
        {error ? <ErrorBanner error={error} /> : null}
      </div>
    </>
  );
}
