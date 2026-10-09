import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryEntry } from '../types';
import { formatDay, isShownKind, isStatusKind } from './format';

/** Status history with the reminders and replies, newest first. Undo asks first (in the app's own confirm card, never a browser pop-up). */
export function HistoryBlock({ history, canUndo, busy = false, onUndo }: { history: HistoryEntry[]; canUndo: boolean; busy?: boolean; onUndo: () => void }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const entries = history.filter((h) => isShownKind(h.kind)).slice().reverse();
  if (entries.length === 0) return null;
  return (
    <section className="history" aria-label={t('applications.history.title')}>
      <h2>{t('applications.history.title')}</h2>
      <ul className="history__list">
        {entries.map((h, i) => (
          <li key={`${h.at}-${h.kind}-${i}`}>
            <span className="history__date">{formatDay(h.at)}</span>
            <span className={`badge ${isStatusKind(h.kind) ? `status-${h.kind}` : 'event'}`}>{t(`applications.history.${h.kind}`)}</span>
            {h.to ? <span>{t('applications.history.to', { to: h.to })}</span> : null}
            {h.note ? <span className="muted">{h.note}</span> : null}
          </li>
        ))}
      </ul>
      {canUndo ? <button type="button" className="btn ghost" disabled={busy} onClick={() => setAsking(true)}>{t('applications.history.undo')}</button> : null}
      {asking ? (
        <div className="card notice" role="alertdialog" aria-label={t('applications.history.undo')}>
          <p>{t('applications.history.undoConfirm')}</p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => { setAsking(false); onUndo(); }}>{t('applications.history.undoYes')}</button>
            <button type="button" className="btn ghost" onClick={() => setAsking(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
