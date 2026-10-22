import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useOptionalSettings } from '../settings';
import type { UpdatesView } from '../types';

const RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * "Version X is available" under the top bar. The server does the daily check against our version.json and
 * answers null when there is nothing to show (switched off, not newer, dismissed). Any failure stays silent.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  // The notes come in the saved UI language: ask again once a language change is saved.
  const language = useOptionalSettings()?.settings.language ?? null;
  const [update, setUpdate] = useState<UpdatesView['available']>(null);
  const [open, setOpen] = useState(false);
  const notesId = useId();

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.getUpdates().then((v) => { if (alive) setUpdate(v.available); }, () => undefined);
    };
    load();
    const timer = window.setInterval(load, RECHECK_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [language]);

  if (!update) return null;
  const dismiss = () => {
    setUpdate(null);
    setOpen(false);
    // Hidden right away; if the server could not remember it, the banner simply comes back at the next check.
    api.dismissUpdate(update.version).catch(() => undefined);
  };

  return (
    <aside className="update-banner">
      <p className="update-banner__text">{t('updates.available', { version: update.version })}</p>
      <div className="update-banner__actions">
        {update.notes ? (
          <button type="button" className="link-btn" aria-expanded={open} aria-controls={notesId} onClick={() => setOpen((o) => !o)}>
            {t('updates.whatsNew')}
          </button>
        ) : null}
        <a className="btn" href={update.url} target="_blank" rel="noopener noreferrer">{t('updates.download')}</a>
      </div>
      {open ? <p id={notesId} className="update-banner__notes">{update.notes}</p> : null}
      <button type="button" className="notice-close" aria-label={t('updates.dismiss')} title={t('updates.dismiss')} onClick={dismiss}>×</button>
    </aside>
  );
}
