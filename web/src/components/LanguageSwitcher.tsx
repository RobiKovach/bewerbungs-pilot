import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '../i18n';
import { confirmLeave } from '../leaveGuard';
import { useSettings } from '../settings';
import type { Language } from '../types';
import { ErrorBanner } from './ErrorBanner';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const { update } = useSettings();
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="lang-switch">
      <select
        aria-label={t('language.label')}
        value={i18n.language}
        onChange={async (e) => {
          // The select is controlled: saying "stay" leaves the old language selected.
          if (!confirmLeave()) return;
          setError(null);
          try { await update({ language: e.target.value as Language }); } catch (err) { setError(err); }
        }}
      >
        {SUPPORTED_LANGUAGES.map((l) => <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>)}
      </select>
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
