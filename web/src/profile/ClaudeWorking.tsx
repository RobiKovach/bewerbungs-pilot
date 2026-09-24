import { useTranslation } from 'react-i18next';

/** "Claude is …" line with a Cancel button, shown while a Claude call runs. */
export function ClaudeWorking({ textKey, onCancel }: { textKey: string; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="btn-row" role="status">
      <span className="muted">{t(textKey)}</span>
      <button type="button" className="btn ghost" onClick={onCancel}>{t('common.cancel')}</button>
    </div>
  );
}
