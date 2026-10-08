import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBanner } from '../components/ErrorBanner';
import { TextField } from '../profile/fields';
import type { OutcomeStatus } from '../types';
import { localDay } from './format';

const OPTIONS: OutcomeStatus[] = ['interview', 'rejected', 'offer', 'withdrawn'];
const NOTE_MAX = 300;

/** "Change status" for a package that was already sent: what happened, on which day, an optional note. */
export function StatusDialog({ onSave, onClose }: { onSave: (body: { status: OutcomeStatus; date: string; note?: string }) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OutcomeStatus>('interview');
  const [date, setDate] = useState(localDay());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const max = localDay(365);
  const dateId = useId();
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= max;
  // Closes only when the parent finishes without an error: a refused save keeps what the person typed.
  const submit = async () => {
    const text = note.trim();
    setSaving(true);
    setError(null);
    try {
      await onSave({ status, date, ...(text ? { note: text } : {}) });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };
  return (
    <div className="card notice" role="dialog" aria-label={t('applications.statusChange.title')}>
      <h2>{t('applications.statusChange.title')}</h2>
      <fieldset className="status-options">
        <legend>{t('applications.statusChange.what')}</legend>
        {OPTIONS.map((o) => (
          <label key={o}><input type="radio" name="outcome" checked={status === o} onChange={() => setStatus(o)} /> {t(`applications.statusChange.${o}`)}</label>
        ))}
      </fieldset>
      <div className="field">
        <div className="field-head"><label htmlFor={dateId}>{t('applications.statusChange.date')}</label></div>
        <input id={dateId} type="date" value={date} max={max} onChange={(e) => setDate(e.target.value)} />
      </div>
      <TextField multiline label={t('applications.statusChange.note')} value={note} onChange={setNote} maxLength={NOTE_MAX} />
      <p className="muted">{t('applications.statusChange.counter', { n: note.length, max: NOTE_MAX })}</p>
      {error ? <ErrorBanner error={error} /> : null}
      <div className="btn-row">
        <button type="button" className="btn" disabled={!dateOk || saving} onClick={() => void submit()}>{saving ? t('applications.statusChange.saving') : t('applications.statusChange.save')}</button>
        <button type="button" className="btn ghost" disabled={saving} onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
