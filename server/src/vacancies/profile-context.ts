import type { Profile } from '@bp/shared';

const noIds = (key: string, value: unknown) => (key === 'id' ? undefined : value);

/**
 * What Claude may know about the person to judge an offer (spec, section 5): the city (distance), work permit and driving
 * licence (often required), education, experience, skills, languages and all job wishes. Never name, contact data,
 * street, postal code, birth date, nationality, photo, stories or "never mention".
 */
export function scoringProfile(profile: Profile): Record<string, unknown> {
  const s = profile.sections;
  return JSON.parse(JSON.stringify({
    city: s.personal.data.city,
    country: s.personal.data.country,
    workPermit: s.personal.data.workPermit,
    drivingLicense: s.personal.data.drivingLicense,
    education: s.education.data.items,
    experience: s.experience.data.items,
    skills: s.skills.data.items,
    languages: s.languages.data.items,
    wishes: s.wishes.data,
  }, noIds)) as Record<string, unknown>;
}
