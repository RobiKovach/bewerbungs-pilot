// Two offers are "the same" when the source number matches, or when company + title match after normalising: job boards
// repost offers under new numbers, and a pasted offer has no number at all.

/** (m/w/d), (w/m/d), (m|w|d), (m/f/d), (d/m/w), (all genders), (gn), (gn*) … */
const GENDER_TAG = /\(\s*(?:[mwdfx](?:\s*[/|,]\s*[mwdfx]){1,3}|all genders|gn\*?|w\/m\/x)\s*\)/giu;
/** Webentwickler*in, :in, _in, /-in, /in, (in), *innen … */
const GENDER_SUFFIX = /(?:[*:_]|\/-?)in(?:nen)?(?![\p{L}\p{N}])|\(in\)/giu;
const LEGAL_FORMS = new Set(['gmbh', 'mbh', 'ag', 'ug', 'se', 'kg', 'kgaa', 'ohg', 'gbr', 'ek', 'ev', 'co', 'haftungsbeschränkt', 'gmbhco']);

const words = (s: string) => s.toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function normalizeTitle(title: string): string {
  return words(title.replace(GENDER_TAG, ' ').replace(GENDER_SUFFIX, '')).join(' ');
}

export function normalizeCompany(company: string): string {
  // "e.K." / "e.V." become "e k" / "e v" after splitting — join single letters back before dropping legal forms.
  const joined = company.replace(/\b([a-z])\.\s?([a-z])\./gi, '$1$2');
  return words(joined).filter((w) => !LEGAL_FORMS.has(w)).join(' ');
}

/** null when company or title is empty after normalising — then only the source number can match. */
export function pairKey(company: string, title: string): string | null {
  const c = normalizeCompany(company);
  const t = normalizeTitle(title);
  return c && t ? `${c}|${t}` : null;
}

export interface DedupCandidate { sourceId: string | null; title: string; company: string }

export function findDuplicate<T extends DedupCandidate>(existing: readonly T[], candidate: DedupCandidate): T | undefined {
  if (candidate.sourceId) {
    const bySource = existing.find((v) => v.sourceId === candidate.sourceId);
    if (bySource) return bySource;
  }
  const key = pairKey(candidate.company, candidate.title);
  return key === null ? undefined : existing.find((v) => pairKey(v.company, v.title) === key);
}
