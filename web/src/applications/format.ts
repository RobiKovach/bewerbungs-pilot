/** DD.MM.YYYY in every UI language, like the rest of the app ("YYYY-MM-DD…" in). */
export const formatDay = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; };

const FROZEN = new Set(['sent', 'submitted', 'interview', 'rejected', 'offer', 'withdrawn']);
/** Same six statuses as the server: once a package is sent it is never edited again. */
export const isFrozen = (status: string) => FROZEN.has(status);

/**
 * The package each vacancy links to. A vacancy can have several (sent ones stay, a new one may follow): the one still
 * being edited wins, else the newest. `editable` = not sent yet (then no new package can be created for it).
 */
export function packageLinks(list: readonly { id: string; vacancyId: string; status: string; createdAt: string }[]): Map<string, { id: string; editable: boolean }> {
  const best = new Map<string, { id: string; status: string; createdAt: string }>();
  for (const a of list) {
    const cur = best.get(a.vacancyId);
    const better = !cur
      || (isFrozen(cur.status) && !isFrozen(a.status))
      || (isFrozen(cur.status) === isFrozen(a.status) && a.createdAt > cur.createdAt);
    if (better) best.set(a.vacancyId, a);
  }
  return new Map([...best].map(([v, a]) => [v, { id: a.id, editable: !isFrozen(a.status) }]));
}

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

/** Same rule as the server: one address, no spaces or list separators, a dot in the domain. */
const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
export const addressOk = (s: string) => s.length <= 254 && ADDRESS.test(s);

/** History entries that record something happened without changing the status. */
export const EVENT_KINDS = ['followUp', 'followUpDismissed', 'reply'] as const;
const EVENTS = new Set<string>(EVENT_KINDS);
/** Kinds the history list can show: the statuses and the events. */
export const isShownKind = (kind: string) => KNOWN.has(kind) || EVENTS.has(kind);
