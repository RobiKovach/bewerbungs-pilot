import { useTranslation } from 'react-i18next';
import type { ApplicationStats } from '../types';

const W = 320, H = 140, LEFT = 28, BOTTOM = 24, TOP = 14, RIGHT = 4;
const PLOT_H = H - BOTTOM - TOP;
const dayMonth = (start: string) => { const [, m, d] = start.split('-'); return `${d}.${m}.`; };
const percent = (x: number) => `${Math.round(x * 100)}%`;

export function StatsBlock({ stats }: { stats: ApplicationStats }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...stats.weeks.map((w) => w.count));
  const slot = (W - LEFT - RIGHT) / Math.max(1, stats.weeks.length);
  const barW = slot * 0.6;
  const alt = `${t('applications.stats.chart')}: ${stats.weeks.map((w) => `${dayMonth(w.start)} ${w.count}`).join(', ')}`;
  const cards = [
    { id: 'sent', value: stats.sent, rate: null },
    { id: 'replies', value: stats.replies, rate: stats.rates?.reply ?? undefined },
    { id: 'interviews', value: stats.interviews, rate: stats.rates?.interview ?? undefined },
    { id: 'offers', value: stats.offers, rate: stats.rates?.offer ?? undefined },
  ];
  return (
    <section className="card stats-block" aria-labelledby="stats-heading">
      <h2 id="stats-heading">{t('applications.stats.title')}</h2>
      <dl className="stats-numbers">
        {cards.map((c) => (
          <div key={c.id} className="stats-number">
            <dt>{t(`applications.stats.${c.id}`)}</dt>
            <dd>
              <strong>{c.value}</strong>
              {c.rate === null ? null : (
                <span className="muted stats-rate"><span>{c.rate === undefined ? '—' : percent(c.rate)}</span> {t('applications.stats.rateOf')}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <svg className="stats-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={alt}>
        <title>{alt}</title>
        <line className="stats-axis" x1={LEFT} y1={TOP} x2={LEFT} y2={H - BOTTOM} />
        <line className="stats-axis" x1={LEFT} y1={H - BOTTOM} x2={W - RIGHT} y2={H - BOTTOM} />
        <text className="stats-label stats-axis-y" x={LEFT - 4} y={TOP + 3} textAnchor="end">{max}</text>
        <text className="stats-label stats-axis-y" x={LEFT - 4} y={H - BOTTOM} textAnchor="end">0</text>
        {stats.weeks.map((w, i) => {
          const h = (w.count / max) * PLOT_H;
          const x = LEFT + i * slot + (slot - barW) / 2;
          return (
            <g key={w.start}>
              <rect className="stats-bar" x={x} y={H - BOTTOM - h} width={barW} height={h} rx="2" />
              {w.count > 0 ? <text className="stats-label stats-value" x={x + barW / 2} y={H - BOTTOM - h - 3} textAnchor="middle">{w.count}</text> : null}
              <text className="stats-label stats-axis-x" x={x + barW / 2} y={H - BOTTOM + 11} textAnchor="middle">{dayMonth(w.start)}</text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
