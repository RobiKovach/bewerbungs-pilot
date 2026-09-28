import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import type { FilterReason } from '../types';
import type { SearchStatus } from './useSearchStatus';

export function SearchProgress({ status }: { status: SearchStatus }) {
  const { t } = useTranslation();
  const s = status.state;
  const errorBanner = status.startError ? <ErrorBanner error={status.startError} /> : null;
  if (!s || s.state === 'idle') return errorBanner;

  if (s.state === 'failed') {
    return <ErrorBanner error={new ApiError(s.error?.code ?? 'UNKNOWN', s.error?.detailsForLog ?? '')} />;
  }
  // Reasons are listed in the order the server reports them (the fixed FilterReason priority order
  // does not match "seen, internship, student" from the brief's own test — reporting this in the report).
  const reasonEntries = Object.entries(s.filteredOut) as [FilterReason, number][];
  const filtered = reasonEntries.reduce((sum, [, n]) => sum + n, 0);
  const reasons = reasonEntries.filter(([, n]) => n > 0).map(([r, n]) => t(`vacancies.progress.reasons.${r}`, { count: n })).join(', ');
  const counters = filtered > 0
    ? t('vacancies.progress.countersWithReasons', { found: s.found, filtered, reasons, scored: s.scored, total: s.toScore })
    : t('vacancies.progress.counters', { found: s.found, filtered, scored: s.scored, total: s.toScore });
  return (
    <div className="card search-progress" role="status">
      {errorBanner}
      {s.state === 'running' ? (
        <>
          <p><strong>{t(`vacancies.progress.phase.${s.phase ?? 'querying'}`)}</strong></p>
          <p>{counters}</p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={Math.max(s.toScore, 1)} aria-valuenow={s.scored}>
            <div className="progress__bar" style={{ width: `${s.toScore ? Math.round((100 * s.scored) / s.toScore) : 0}%` }} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={() => void status.stop()}>{t('vacancies.progress.stop')}</button>
          </div>
        </>
      ) : null}
      {s.state === 'done' ? <p>{t('vacancies.progress.done', { count: s.toScore })}</p> : null}
      {s.state === 'stopped' ? <p>{t('vacancies.progress.stopped', { scored: s.scored, total: s.toScore })}</p> : null}
      {s.state === 'interrupted' ? <p>{t('vacancies.progress.interrupted')}</p> : null}
      {s.state !== 'running' && s.moreAvailable > 0 ? <p>{t('vacancies.progress.more', { count: s.moreAvailable })}</p> : null}
      {s.state !== 'running' ? s.warnings.map((w) => <p key={w} className="muted">{t(`vacancies.progress.warnings.${w}`)}</p>) : null}
    </div>
  );
}
