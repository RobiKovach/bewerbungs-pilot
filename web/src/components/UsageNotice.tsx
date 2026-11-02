import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useOptionalSettings } from '../settings';

/**
 * Said once to everyone who has finished the welcome steps (those who set up with this version saw it there): the app
 * reports daily that it is used. Only informs; "OK" remembers it was shown. Never in the demo.
 */
export function UsageNotice() {
  const { t } = useTranslation();
  const ctx = useOptionalSettings();
  // null = not known yet: nothing is shown until the server has said this is not the demo copy.
  const [demo, setDemo] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    api.health().then((h) => { if (alive) setDemo(h.demo === true); }, () => { if (alive) setDemo(false); });
    return () => { alive = false; };
  }, []);
  const [hidden, setHidden] = useState(false);
  if (!ctx || demo !== false || hidden) return null;
  const { settings, update } = ctx;
  if (!settings.onboarding.completed || settings.usage.noticeShown) return null;
  const ok = () => {
    setHidden(true);
    // If it could not be saved the notice simply comes back at the next start.
    void update({ usage: { noticeShown: true } }).catch(() => undefined);
  };
  return (
    <aside className="update-banner usage-notice" role="status">
      <p className="update-banner__text">{t('usageNotice.text')}</p>
      <div className="update-banner__actions">
        <a className="btn ghost" href="#/settings" onClick={ok}>{t('usageNotice.settings')}</a>
        <button type="button" className="btn" onClick={ok}>{t('usageNotice.ok')}</button>
      </div>
    </aside>
  );
}
