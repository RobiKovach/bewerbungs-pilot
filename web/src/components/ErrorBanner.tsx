import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, i18n } = useTranslation();
  const code = error instanceof ApiError ? error.code : 'UNKNOWN';
  const key = i18n.exists(`errors.${code}.message`) ? code : 'UNKNOWN';
  const details = error instanceof ApiError ? error.details : String(error);
  return (
    <div className="error-banner" role="alert">
      <strong>{t(`errors.${key}.message`)}</strong>
      <p>{t(`errors.${key}.hint`)}</p>
      {details ? (
        <details>
          <summary>{t('common.details')}</summary>
          <pre>{`${code}: ${details}`}</pre>
        </details>
      ) : null}
      {onRetry ? <button type="button" className="btn" onClick={onRetry}>{t('common.retry')}</button> : null}
    </div>
  );
}
