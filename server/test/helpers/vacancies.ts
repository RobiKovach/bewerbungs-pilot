import type { Profile, Vacancy, WishesData } from '@bp/shared';
import { emptyProfile } from '../../src/profile/schema.js';
import type { SourceHit } from '../../src/vacancies/sources/types.js';

let n = 0;
/** A fictional Arbeitsagentur hit; every call gets a new number unless one is given. */
export function hit(over: Partial<SourceHit> = {}): SourceHit {
  n++;
  const sourceId = over.sourceId ?? `10000-${String(n).padStart(10, '0')}-S`;
  return {
    sourceId, title: `Webentwickler ${n} (m/w/d)`, company: `Firma ${n} GmbH`, locations: ['Dresden'], remote: 'unknown',
    employment: ['fulltime'], salaryText: '', publishedAt: '2026-09-20',
    url: `https://www.arbeitsagentur.de/jobsuche/jobdetail/${sourceId}`, ...over,
  };
}

export function vacancy(over: Partial<Vacancy> = {}): Vacancy {
  n++;
  return {
    id: over.id ?? `v${n}`, source: 'arbeitsagentur', sourceId: `10000-${String(n).padStart(10, '0')}-S`, addedManually: false,
    title: `Webentwickler ${n}`, company: `Firma ${n} GmbH`, locations: ['Dresden'], remote: 'unknown', employment: [],
    salaryText: '', publishedAt: '2026-09-20', foundAt: '2026-09-28T10:00:00.000Z', url: '', contact: null, hasText: false,
    status: 'new', scoreState: 'scored', score: { value: 70, why: ['a'], missing: [], scoredAt: '2026-09-28T10:00:00.000Z' },
    hiddenAt: null, ...over,
  };
}

export function profileWithWishes(wishes: Partial<WishesData>, change: (p: Profile) => void = () => {}): Profile {
  const p = emptyProfile();
  p.sections.wishes.data = { ...p.sections.wishes.data, ...wishes };
  change(p);
  return p;
}
