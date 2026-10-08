/** DD.MM.YYYY in every UI language, like the rest of the app ("YYYY-MM-DD…" in). */
export const formatDay = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; };

const FROZEN = new Set(['sent', 'submitted', 'interview', 'rejected', 'offer', 'withdrawn']);
/** Same six statuses as the server: once a package is sent it is never edited again. */
export const isFrozen = (status: string) => FROZEN.has(status);
