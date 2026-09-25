import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, i18n } = useTranslation();
  const code = error instanceof ApiError ? error.code : 'UNKNOWN';
  const key = i18n.exists(`errors.${code}.message`) ? code : 'UNKNOWN';
  const details = error instanceof ApiError ? error.details : String(error);
  const reason = error instanceof ApiError ? error.reason : undefined;
  const hasReason = !!reason && i18n.exists(`errors.reasons.${reason}`);
  let reasonText: string | null = null;
  if (hasReason && reason) {
    // Server params are machine-readable ids (a raw section id, an upload "kind"); turn them into the
    // words a person actually reads before handing everything to i18next for interpolation.
    const params: Record<string, string | number> = { ...(error instanceof ApiError ? error.params : undefined) };
    if (reason === 'profileMissing' && typeof params.sections === 'string') {
      params.sections = params.sections.split(',').filter(Boolean).map((id) => t(`profile.sections.${id}.title`)).join(', ');
    }
    if (reason === 'fileTypeDetected' && typeof params.kind === 'string') {
      params.allowed = t(`errors.reasons.allowedTypes.${params.kind}`);
    }
    reasonText = t(`errors.reasons.${reason}`, params);
  }
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
