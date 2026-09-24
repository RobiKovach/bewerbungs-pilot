import type { Profile, Readiness, ReadinessWarning } from '@bp/shared';
import { AppError } from '../errors.js';
import { SECTION_IDS } from './schema.js';

/** Ready = every section confirmed by the person. Stories are optional, but without one cover letters get generic. */
export function readiness(profile: Profile): Readiness {
  const missing = SECTION_IDS.filter((id) => profile.sections[id].confirmedAt === null);
  const hasStory = profile.stories.some((s) => s.confirmed && s.disclosure === 'ok');
  const warnings: ReadinessWarning[] = hasStory ? [] : ['noStories'];
  return { ready: missing.length === 0, missing, warnings };
}

/** For sub-projects 3/4: call before matching vacancies or writing an application. */
export function assertReady(profile: Profile): void {
  const r = readiness(profile);
  if (!r.ready) throw new AppError('PROFILE_NOT_READY', `missing: ${r.missing.join(', ')}`);
}
