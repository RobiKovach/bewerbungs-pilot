import { useTranslation } from 'react-i18next';

/** The app stopped answering while something was being watched (search, a Claude job): say so instead of spinning on. */
export function ConnectionLost({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="notice" role="alert">
      <p>{t('common.connectionLost')}</p>
      <div className="btn-row"><button type="button" className="btn ghost" onClick={onRetry}>{t('common.checkAgain')}</button></div>
    </div>
  );
}
