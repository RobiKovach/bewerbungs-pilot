import { useTranslation } from 'react-i18next';
import type { HistoryEntry } from '../types';
import { formatDay } from './format';

/** "No answer for 14 days": offers to write a reminder or to switch the reminder off. */
export function FollowUpNotice({ history, busy, onWrite, onDismiss }: { history: HistoryEntry[]; busy: boolean; onWrite: () => void; onDismiss: () => void }) {
  const { t } = useTranslation();
  const sent = history.filter((h) => h.kind === 'sent' || h.kind === 'submitted').pop();
  return (
    <div className="card notice follow-up" role="status">
      {sent ? <p>{t('applications.followUp.notice', { date: formatDay(sent.at) })}</p> : null}
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy} onClick={onWrite}>{t('applications.followUp.write')}</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onDismiss}>{t('applications.followUp.dismiss')}</button>
      </div>
    </div>
  );
}
