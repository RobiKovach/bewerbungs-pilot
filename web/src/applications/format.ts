/** DD.MM.YYYY in every UI language, like the rest of the app ("YYYY-MM-DD…" in). */
export const formatDay = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; };
