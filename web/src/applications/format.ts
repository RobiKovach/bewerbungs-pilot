/** DD.MM.YYYY in every UI language, like the rest of the app ("YYYY-MM-DD…" in). */
export const formatDay = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; };

const FROZEN = new Set(['sent', 'submitted', 'interview', 'rejected', 'offer', 'withdrawn']);
/** Same six statuses as the server: once a package is sent it is never edited again. */
export const isFrozen = (status: string) => FROZEN.has(status);

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day as YYYY-MM-DD, `offsetDays` from today (for the status date field). */
export const localDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const STATUSES = ['draft', 'approved', 'sent', 'submitted', 'interview', 'rejected', 'offer', 'withdrawn'] as const;
const KNOWN = new Set<string>(STATUSES);
/** 0.7.0 adds history kinds that are not statuses: only known statuses are shown here. */
export const isStatusKind = (kind: string) => KNOWN.has(kind);
