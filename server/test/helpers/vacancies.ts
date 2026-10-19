import type { Profile, ProviderId, Vacancy, WishesData } from '@bp/shared';
import { emptyProfile } from '../../src/profile/schema.js';
import { AppError } from '../../src/errors.js';
import { FakeProvider } from '../../src/llm/fake.js';
import type { LlmTask } from '../../src/llm/types.js';
import type { SearchQuery, SourceDetails, SourceHit, VacancySource } from '../../src/vacancies/sources/types.js';

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
    status: 'new', scoreState: 'scored', score: { value: 70, why: ['a'], missing: [], scoredAt: '2026-09-28T10:00:00.000Z', provider: 'claude', language: 'de' },
    hiddenAt: null, ...over,
  };
}

export function profileWithWishes(wishes: Partial<WishesData>, change: (p: Profile) => void = () => {}): Profile {
  const p = emptyProfile();
  p.sections.wishes.data = { ...p.sections.wishes.data, ...wishes };
  change(p);
  return p;
}

export function details(h: SourceHit, text = `Volltext für ${h.title}. React, TypeScript.`): SourceDetails {
  return { ...h, text };
}

export interface FakeSource extends VacancySource { queries: SearchQuery[]; detailCalls: string[]; onlineCalls: string[] }

export function fakeSource(opts: {
  search?: (q: SearchQuery) => SourceHit[] | Promise<SourceHit[]>;
  details?: (id: string) => SourceDetails | null | Promise<SourceDetails | null>;
  online?: (id: string) => boolean;
} = {}): FakeSource {
  const known = new Map<string, SourceHit>();
  const src: FakeSource = {
    id: 'arbeitsagentur', queries: [], detailCalls: [], onlineCalls: [],
    async search(q, signal) {
      if (signal.aborted) throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
      src.queries.push(q);
      const hits = await (opts.search ?? (() => []))(q);
      for (const h of hits) known.set(h.sourceId, h);
      return hits;
    },
    async details(id, signal) {
      if (signal.aborted) throw new AppError('LLM_CANCELLED', 'stopped', 'cancelledByUser');
      src.detailCalls.push(id);
      if (opts.details) return opts.details(id);
      const h = known.get(id);
      return h ? details(h) : null;
    },
    async isOnline(id) {
      src.onlineCalls.push(id);
      return (opts.online ?? (() => true))(id);
    },
  };
  return src;
}

const offerIds = (prompt: string) => [...prompt.matchAll(/^Offer id: (\S+)$/gm)].map((m) => m[1]);

export function scoringClaude(opts: {
  score?: (id: string) => number | null;
  manual?: unknown;
  before?: (task: LlmTask, signal: AbortSignal) => unknown;
  /** Which AI helper this fake pretends to be (default claude). */
  id?: ProviderId;
} = {}): FakeProvider {
  return new FakeProvider({ ok: true }, async (task, signal) => {
    await opts.before?.(task, signal);
    if (signal.aborted) throw new AppError('LLM_CANCELLED', 'cancelled', 'cancelledByUser');
    const required = (task.schema as { required?: string[] }).required ?? [];
    if (required.includes('isVacancy')) {
      if (opts.manual === undefined) throw new Error('unexpected manual task');
      return opts.manual;
    }
    const score = opts.score ?? (() => 70);
    return {
      results: offerIds(task.prompt).flatMap((id) => {
        const value = score(id);
        return value === null ? [] : [{ id, score: value, why: ['passt'], missing: [] }];
      }),
    };
  }, opts.id);
}
