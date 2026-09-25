import type { SectionDataMap, SectionId } from '../types';
import { LIMITS } from './constants';

/** Same pattern the server checks: "YYYY", "YYYY-MM" or empty. */
export const YEAR_MONTH = /^(\d{4}(-(0[1-9]|1[0-2]))?)?$/;

/** What stops a section from being saved, as a translation key — or null when the server will accept it. */
export function sectionProblem(id: SectionId, data: SectionDataMap[SectionId]): 'profile.fixDates' | 'profile.fixLines' | null {
  if (id === 'education' || id === 'experience') {
    const ok = (data as SectionDataMap['experience']).items.every((e) => YEAR_MONTH.test(e.from) && YEAR_MONTH.test(e.to));
    return ok ? null : 'profile.fixDates';
  }
  if (id === 'wishes') {
    const w = data as SectionDataMap['wishes'];
    return w.jobTitles.length > LIMITS.lines || w.locations.length > LIMITS.lines ? 'profile.fixLines' : null;
  }
  return null;
}
