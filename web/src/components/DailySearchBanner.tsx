import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';

const RECHECK_MS = 10 * 60_000;

/** "The daily search found N new offers" (0.14.0): once per automatic search, until closed or the offers are opened. */
export function DailySearchBanner({ recheckMs = RECHECK_MS }: { recheckMs?: number }) {
  const { t } = useTranslation();
  const [found, setFound] = useState<{ count: number; run: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      api.searchState().then((s) => {
        if (!alive) return;
        setFound(s.automatic === true && s.state !== 'running' && s.toScore > 0 ? { count: s.toScore, run: s.startedAt } : null);
      }, () => undefined);
    };
    load();
    const timer = window.setInterval(load, recheckMs);
    return () => { alive = false; window.clearInterval(timer); };
  }, [recheckMs]);
  if (!found) return null;
  // Hidden right away; if the server could not remember it, the banner comes back at the next check.
  const seen = () => { setFound(null); api.searchSeen(found.run).catch(() => undefined); };
  return (
    <aside className="update-banner" role="status">
      <p className="update-banner__text">{t('dailySearch.found', { count: found.count })}</p>
      <div className="update-banner__actions"><a className="btn small" href="#/vacancies" onClick={seen}>{t('dailySearch.show')}</a></div>
      <button type="button" className="notice-close" aria-label={t('common.dismiss')} title={t('common.dismiss')} onClick={seen}>×</button>
    </aside>
  );
}
