import type { ApplicationPackage, ApplicationStats } from '@bp/shared';

const WEEKS = 8;
const REPLY_KINDS = new Set(['interview', 'rejected', 'offer']);

function monday(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Counts packages, not emails. "Sent" = a `sent` or `submitted` entry; its week = the local Monday of the first such entry. */
export function applicationStats(packages: ApplicationPackage[], now: Date): ApplicationStats {
  const thisMonday = monday(now);
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const start = new Date(thisMonday);
    start.setDate(start.getDate() - 7 * (WEEKS - 1 - i));
    return { start: key(start), count: 0 };
  });
  let sent = 0, replies = 0, interviews = 0, offers = 0;
  for (const p of packages) {
    const first = p.history.find((h) => h.kind === 'sent' || h.kind === 'submitted');
    if (!first) continue;
    sent++;
    if (p.history.some((h) => REPLY_KINDS.has(h.kind))) replies++;
    if (p.history.some((h) => h.kind === 'interview')) interviews++;
    if (p.history.some((h) => h.kind === 'offer')) offers++;
    const week = weeks.find((w) => w.start === key(monday(new Date(first.at))));
    if (week) week.count++;
  }
  const rates = sent === 0 ? null : { reply: replies / sent, interview: interviews / sent, offer: offers / sent };
  return { sent, replies, interviews, offers, rates, weeks };
}
