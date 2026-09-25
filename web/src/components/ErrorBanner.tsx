import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';
import { reasonParams } from './errorReason';

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, i18n } = useTranslation();
  const code = error instanceof ApiError ? error.code : 'UNKNOWN';
  const key = i18n.exists(`errors.${code}.message`) ? code : 'UNKNOWN';
  const details = error instanceof ApiError ? error.details : String(error);
  const reason = error instanceof ApiError ? error.reason : undefined;
  const reasonText = error instanceof ApiError && reason && i18n.exists(`errors.reasons.${reason}`)
    ? t(`errors.reasons.${reason}`, reasonParams(reason, error.params, t))
    : null;
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
      {onRetry ? <button type="button" className="btn" onClick={onRetry}>{t('common.retry')}</button> : null}
    </div>
  );
}
