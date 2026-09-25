import type { CvSectionId, Profile, ProfileView, Section, SectionId } from '@bp/shared';
import { readiness } from './readiness.js';

export const toView = (profile: Profile): ProfileView => ({ profile, readiness: readiness(profile) });

/** Section ids and data are checked at runtime (isSectionId, validateSectionData); this keeps the type juggling here. */
export function withSection(p: Profile, id: SectionId, change: (s: Section<unknown>) => Section<unknown>): void {
  const sections = p.sections as unknown as Record<SectionId, Section<unknown>>;
  sections[id] = change(sections[id]);
}

/** The same juggling for a section's CV proposal; null removes it. The store validates the data on update. */
export function setProposal(p: Profile, id: CvSectionId, data: unknown): void {
  const proposals = p.cvProposals as Partial<Record<CvSectionId, unknown>>;
  if (data === null) delete proposals[id];
  else proposals[id] = data;
}
