import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { Language } from '../types';
import { ErrorBanner } from './ErrorBanner';

/**
 * «Try the demo» (spec 0.10.0): starts the demo copy and opens it in a new tab; this tab stays as it is.
 * Only this click starts the demo - a normal start of the app always opens the person's own, empty profile.
 */
export function TryDemoButton({ onOpened }: { onOpened?: () => void }) {
  const { t, i18n } = useTranslation();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // The tab is opened right in the click (a tab opened after the answer would be blocked as a pop-up), then sent to the demo.
  const tryDemo = async () => {
    setError(null);
    setStarting(true);
    const tab = window.open('', '_blank');
    try {
      const { url } = await api.startDemo(i18n.language as Language);
      if (tab) tab.location.href = url; else window.location.href = url;
      onOpened?.();
    } catch (err) {
      tab?.close();
      setError(err);
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <button type="button" className="btn ghost" disabled={starting} onClick={() => void tryDemo()}>
        {starting ? t('onboarding.welcome.demoStarting') : t('onboarding.welcome.tryDemo')}
      </button>
      {error ? <ErrorBanner error={error} /> : null}
    </>
  );
}
