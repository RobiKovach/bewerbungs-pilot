import type { Profile, ProfileView, Section, SectionId } from '@bp/shared';
import { readiness } from './readiness.js';

export const toView = (profile: Profile): ProfileView => ({ profile, readiness: readiness(profile) });

/** Section ids and data are checked at runtime (isSectionId, validateSectionData); this keeps the type juggling here. */
export function withSection(p: Profile, id: SectionId, change: (s: Section<unknown>) => Section<unknown>): void {
  const sections = p.sections as unknown as Record<SectionId, Section<unknown>>;
  sections[id] = change(sections[id]);
}
