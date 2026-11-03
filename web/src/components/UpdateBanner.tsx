import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, muteNoSession } from '../api';
import { useOptionalSettings } from '../settings';
import type { UpdateFailure, UpdatesView } from '../types';
import { reasonParams } from './errorReason';
import { UpdateProgress } from './UpdateProgress';

const RECHECK_MS = 6 * 60 * 60 * 1000;

type Notice = { kind: 'updated'; version: string } | { kind: 'failed'; why: UpdateFailure };

/**
 * "Version X is available" under the top bar. The server does the daily check against our version.json and
 * answers null when there is nothing to show (switched off, not newer, dismissed). Any failure stays silent.
 * With a checksum in version.json there is also "Update now" (0.11.0): the app updates itself.
 * The first answer after an update (or a failed one) also says how it went — once.
 */
export function UpdateBanner() {
  const { t, i18n } = useTranslation();
  // The notes come in the saved UI language: ask again once a language change is saved.
  const language = useOptionalSettings()?.settings.language ?? null;
  const [update, setUpdate] = useState<UpdatesView['available']>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [running, setRunning] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [reload, setReload] = useState(0);
  const notesId = useId();

  useEffect(() => {
    let alive = true;
    let retry: number | undefined;
    // The installer reports its end a little after the new app started: ask again every 2 s, for up to 3 minutes.
    const giveUpAt = Date.now() + 3 * 60_000;
    const load = () => {
      api.getUpdates().then((v) => {
        if (!alive) return;
        if (v.updatePending && Date.now() < giveUpAt) retry = window.setTimeout(load, 2000);
        setUpdate(v.available);
        // These come once: a later answer without them must not hide what was already shown.
        if (v.justUpdated) setNotice({ kind: 'updated', version: v.justUpdated });
        else if (v.lastUpdateError) setNotice({ kind: 'failed', why: v.lastUpdateError });
      }, () => undefined);
    };
    load();
    const timer = window.setInterval(load, RECHECK_MS);
    return () => { alive = false; window.clearInterval(timer); window.clearTimeout(retry); };
  }, [language, reload]);

  const noticeEl = notice ? (
    <aside className="update-banner" role="status">
      <p className="update-banner__text">
        {notice.kind === 'updated'
          ? t('updates.justUpdated', { version: notice.version })
          : t(`updates.error.${notice.why}`)}
      </p>
      <button type="button" className="notice-close" aria-label={t('updates.close')} title={t('updates.close')} onClick={() => setNotice(null)}>×</button>
    </aside>
  ) : null;

  if (!update) return noticeEl;
  const dismiss = () => {
    setUpdate(null);
    setOpen(false);
    // Hidden right away; if the server could not remember it, the banner simply comes back at the next check.
    api.dismissUpdate(update.version).catch(() => undefined);
  };
  const updateNow = async () => {
    setRefusal(null);
    setStarting(true);
    try {
      await api.applyUpdate();
      // From here the server will be replaced: this tab must not switch to the "open via the shortcut" screen.
      muteNoSession(true);
      setRunning(true);
    } catch (err) {
      const reason = err instanceof ApiError ? err.reason : undefined;
      setRefusal(reason && i18n.exists(`errors.reasons.${reason}`)
        ? t(`errors.reasons.${reason}`, reasonParams(reason, err instanceof ApiError ? err.params : undefined, t))
        : t('updates.startFailed'));
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      {noticeEl}
      <aside className="update-banner">
        <p className="update-banner__text">{t('updates.available', { version: update.version })}</p>
        <div className="update-banner__actions">
          {update.canInstall ? (
            <button type="button" className="btn" disabled={starting} onClick={() => void updateNow()}>{t('updates.updateNow')}</button>
          ) : null}
          {update.notes ? (
            <button type="button" className="link-btn" aria-expanded={open} aria-controls={notesId} onClick={() => setOpen((o) => !o)}>
              {t('updates.whatsNew')}
            </button>
          ) : null}
          <a className={update.canInstall ? "btn ghost" : "btn"} href={update.url} target="_blank" rel="noopener noreferrer">{t('updates.download')}</a>
        </div>
        {refusal ? <p className="update-banner__notes" role="alert">{refusal}</p> : null}
        {open ? <p id={notesId} className="update-banner__notes">{update.notes}</p> : null}
        <button type="button" className="notice-close" aria-label={t('updates.dismiss')} title={t('updates.dismiss')} onClick={dismiss}>×</button>
      </aside>
      {running ? <UpdateProgress target={update.version} onClose={() => { setRunning(false); setReload((n) => n + 1); }} /> : null}
    </>
  );
}
