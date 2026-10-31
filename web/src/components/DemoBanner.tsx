import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';

/** True in the demo copy of the app (spec 0.10.0); an older server or a failed check counts as the real app. */
export function useIsDemo(): boolean {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    let alive = true;
    api.health().then((h) => { if (alive) setDemo(h.demo === true); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return demo;
}

export function DemoBanner({ onLeave }: { onLeave: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="demo-banner" role="status" aria-label={t('demo.badge')}>
      <span className="badge demo-badge">{t('demo.badge')}</span>
      <span>{t('demo.text')}</span>
      <button type="button" className="btn ghost" onClick={onLeave}>{t('demo.leave')}</button>
    </div>
  );
}
