import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import type { ApplicationView } from '../types';

/** Letter + CV add roughly 0.2 MB; many portals accept 5 MB in total (spec, decision 8). */
export const ATTACHMENTS_WARN_BYTES = 4.8 * 1024 * 1024;
export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Each click saves at once, so this tab never holds unsaved edits. */
export function AttachmentsTab({ view, locked, onView }: { view: ApplicationView; locked: boolean; onView: (v: ApplicationView) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const selected = view.attachments.filter((x) => x.selected).map((x) => x.id);
  const total = view.attachments.filter((x) => x.selected && !x.missing).reduce((sum, x) => sum + x.size, 0);
  const toggle = async (id: string) => {
    setError(null);
    setSaving(true);
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    try { onView(await api.setAttachments(view.application.id, next)); } catch (err) { setError(err); } finally { setSaving(false); }
  };
  return (
    <div>
      {view.attachments.length === 0 ? (
        <p className="muted">{t('applications.attachments.none')} <a href="#/profile">{t('applications.attachments.toProfile')}</a></p>
      ) : (
        <ul className="attachment-list">
          {view.attachments.map((x) => (
            <li key={x.id}>
              <label>
                <input type="checkbox" checked={x.selected} disabled={locked || saving} onChange={() => void toggle(x.id)} />{' '}
                {x.missing ? t('applications.attachments.missing') : <>{x.label} <span className="muted">({mb(x.size)})</span></>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">{t('applications.attachments.total', { size: mb(total) })}</p>
      {total > ATTACHMENTS_WARN_BYTES ? <p className="notice">{t('applications.attachments.tooBig')}</p> : null}
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
