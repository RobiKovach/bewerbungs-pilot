import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';
import { useOptionalSettings } from '../settings';
import { reasonParams } from './errorReason';

/** Errors that are fixed in Settings → AI helper get a link there (a normal hash link: the unsaved-changes guard applies). */
const AI_SETTINGS_CODES = new Set(['LLM_NOT_CHOSEN', 'LLM_NOT_INSTALLED', 'LLM_NOT_LOGGED_IN']);
export const AI_SETTINGS_HASH = '#/settings/ai';

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, i18n } = useTranslation();
  const ctx = useOptionalSettings();
  const code = error instanceof ApiError ? error.code : 'UNKNOWN';
  const key = i18n.exists(`errors.${code}.message`) ? code : 'UNKNOWN';
  const details = error instanceof ApiError ? error.details : String(error);
  const reason = error instanceof ApiError ? error.reason : undefined;
  const reasonText = error instanceof ApiError && reason && i18n.exists(`errors.reasons.${reason}`)
    ? t(`errors.reasons.${reason}`, reasonParams(reason, error.params, t))
    : null;
  // Not during the welcome steps (no pages there) and not on the Settings page itself.
  const showAiLink = AI_SETTINGS_CODES.has(code) && (ctx?.settings.onboarding.completed ?? true)
    && !window.location.hash.startsWith('#/settings');
  return (
    <div className="error-banner" role="alert">
      <strong>{t(`errors.${key}.message`)}</strong>
      <p>{t(`errors.${key}.hint`)}</p>
      {details ? (
        <details>
          <summary>{t('common.details')}</summary>
          {reasonText ? <p className="error-banner__reason">{reasonText}</p> : null}
          <p className="error-banner__technical-label muted">{t('common.technicalDetails')}</p>
          <pre>{`${code}: ${details}`}</pre>
        </details>
      ) : null}
      {showAiLink ? <p><a href={AI_SETTINGS_HASH}>{t('common.openAiSettings')}</a></p> : null}
      {onRetry ? <button type="button" className="btn" onClick={onRetry}>{t('common.retry')}</button> : null}
    </div>
  );
}
