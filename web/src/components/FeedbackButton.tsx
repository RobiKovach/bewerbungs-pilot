import { useTranslation } from 'react-i18next';

/** "Feedback" in the top bar: opens the feedback window (the window itself lives in Layout). */
export function FeedbackButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="btn ghost" aria-expanded={open} onClick={onClick}>{t('feedback.button')}</button>
  );
}
