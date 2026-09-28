import type { EmploymentType, RemoteKind } from '@bp/shared';

export type OfferKind = 'work' | 'apprenticeship' | 'internship';
export type WorkTime = 'fulltime' | 'parttime' | 'minijob';

export interface SearchQuery {
  jobTitle: string;
  location: string | null;
  radiusKm: number | null;
  kind: OfferKind;
  workTimes: WorkTime[];
  publishedWithinDays: number;
  includeTemporaryAgencies: boolean;
}

export interface SourceHit {
  sourceId: string;
  title: string;
  company: string;
  locations: string[];
  remote: RemoteKind;
  employment: EmploymentType[];
  salaryText: string;
  publishedAt: string;
  url: string;
}

export interface SourceDetails extends SourceHit {
  text: string;
}

export interface VacancySource {
  readonly id: 'arbeitsagentur';
  search(query: SearchQuery, signal: AbortSignal): Promise<SourceHit[]>;
  /** null = the offer is gone (the source answered "not found"). */
  details(sourceId: string, signal: AbortSignal): Promise<SourceDetails | null>;
  isOnline(sourceId: string, signal: AbortSignal): Promise<boolean>;
}
