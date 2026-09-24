import type { SectionDataMap, SectionId } from '../types';

/** Same pattern the server checks: "YYYY", "YYYY-MM" or empty. */
export const YEAR_MONTH = /^(\d{4}(-(0[1-9]|1[0-2]))?)?$/;

export function sectionIsValid(id: SectionId, data: SectionDataMap[SectionId]): boolean {
  if (id !== 'education' && id !== 'experience') return true;
  return (data as SectionDataMap['experience']).items.every((e) => YEAR_MONTH.test(e.from) && YEAR_MONTH.test(e.to));
}
