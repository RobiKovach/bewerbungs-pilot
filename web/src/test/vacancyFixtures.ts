import type { Profile, SearchState, Vacancy } from '../types';
import type { RouteHandler } from './fetchMock';
import { baseSettings, settingsRoutes } from './fixtures';
import { profileWith, viewOf } from './profileFixtures';

let n = 0;
export function vac(over: Partial<Vacancy> = {}): Vacancy {
  n++;
  return {
    id: `v${n}`, source: 'arbeitsagentur', sourceId: `10000-${n}-S`, addedManually: false, title: `Webentwickler ${n} (m/w/d)`,
    company: `Firma ${n} GmbH`, locations: ['Dresden'], remote: 'partial', employment: ['fulltime'], salaryText: '',
    publishedAt: '2026-09-22', foundAt: '2026-09-28T10:00:00.000Z', url: `https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-${n}-S`,
    contact: null, hasText: true, status: 'new', scoreState: 'scored',
    score: { value: 70, why: ['React passt'], missing: [], scoredAt: '2026-09-28T10:05:00.000Z' }, hiddenAt: null, ...over,
  };
}

export function searchState(over: Partial<SearchState> = {}): SearchState {
  return {
    state: 'idle', phase: null, found: 0, filteredOut: {}, afterFilter: 0, toScore: 0, scored: 0, moreAvailable: 0, warnings: [],
    error: null, startedAt: null, finishedAt: null, ...over,
  };
}

export function readyProfile(): Profile {
  return profileWith((p) => {
    p.sections.wishes.data = { ...p.sections.wishes.data, jobTitles: ['Webentwickler', 'Frontend Developer'], locations: ['Dresden'], radiusKm: 30, employmentTypes: ['fulltime'] };
  });
}

export function vacancyServer(opts: { list?: Vacancy[]; profile?: Profile; search?: SearchState } = {}) {
  const list = opts.list ?? [];
  const settings = settingsRoutes(baseSettings());
  const routes: Record<string, RouteHandler> = {
    ...settings.routes,
    'GET /api/profile': () => ({ body: viewOf(opts.profile ?? readyProfile()) }),
    'GET /api/vacancies': () => ({ body: { vacancies: list } }),
    'GET /api/vacancies/search': () => ({ body: opts.search ?? searchState() }),
  };
  return { routes, list };
}
