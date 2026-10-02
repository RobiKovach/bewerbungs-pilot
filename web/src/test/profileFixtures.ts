import { SECTION_IDS } from '../profile/constants';
import type { Profile, ProfileView } from '../types';

export function emptyProfile(): Profile {
  const blank = <T>(data: T) => ({ data, aiFields: [] as string[], confirmedAt: null as string | null, editedAt: null as string | null });
  return {
    schemaVersion: 4,
    wizard: { step: 1, completedAt: null },
    cv: null,
    sections: {
      personal: blank({ fullName: '', email: '', phone: '', street: '', postalCode: '', city: '', country: '', birthDate: '', nationality: '', workPermit: '', drivingLicense: '', links: [] }),
      education: blank({ items: [] }),
      experience: blank({ items: [] }),
      skills: blank({ items: [] }),
      languages: blank({ items: [] }),
      wishes: blank({
        jobTitles: [], locations: [], radiusKm: null, remote: 'any' as const, employmentTypes: [], salaryMinEur: null, availableFrom: '',
        notes: '', includeTemporaryAgencies: true,
      }),
    },
    stories: [],
    neverMention: [],
    pendingQuestions: [],
    photo: null,
    documents: [],
    cvProposals: {},
  };
}

export function profileWith(change: (p: Profile) => void): Profile {
  const p = emptyProfile();
  change(p);
  return p;
}

/** Same rule as server/src/profile/readiness.ts. */
export function viewOf(profile: Profile): ProfileView {
  const missing = SECTION_IDS.filter((id) => profile.sections[id].confirmedAt === null);
  const hasStory = profile.stories.some((s) => s.confirmed && s.disclosure === 'ok');
  return { profile, readiness: { ready: missing.length === 0, missing: [...missing], warnings: hasStory ? [] : ['noStories'] } };
}
