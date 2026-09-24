import type { SectionDataMap, SectionId } from '../../types';

export interface FormProps<K extends SectionId> {
  data: SectionDataMap[K];
  onChange: (data: SectionDataMap[K]) => void;
  /** Path as the server names it: "fullName", "jobTitles", "items.<id>.jobTitle". */
  isAi: (path: string) => boolean;
}
