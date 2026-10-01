import type { PackageReadiness, Profile } from '@bp/shared';
import { AppError } from '../errors.js';
import { CV_SECTION_IDS } from '../profile/schema.js';

/**
 * A package needs the five CV sections confirmed and at least one confirmed story that may be told (spec, decision 4).
 * The job wishes are not needed: only the city/remote wish is used, for the Home Office sentence.
 */
export function packageReadiness(profile: Profile): PackageReadiness {
  const missingSections = CV_SECTION_IDS.filter((id) => profile.sections[id].confirmedAt === null);
  const noStory = !profile.stories.some((s) => s.confirmed && s.disclosure === 'ok');
  return { ready: missingSections.length === 0 && !noStory, missingSections: [...missingSections], noStory };
}

export function assertPackageReady(profile: Profile): void {
  const r = packageReadiness(profile);
  if (r.missingSections.length > 0) {
    throw new AppError('PROFILE_NOT_READY', `missing: ${r.missingSections.join(', ')}`, 'profileMissing', { sections: r.missingSections.join(',') });
  }
  if (r.noStory) throw new AppError('PROFILE_NOT_READY', 'no confirmed story that may be told', 'noStory');
}
