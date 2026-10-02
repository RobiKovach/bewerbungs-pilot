import crypto from 'node:crypto';
import type { PackageSnapshot, Profile } from '@bp/shared';

/** JSON with sorted keys, so the same data always gives the same text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function takeSnapshot(profile: Profile): PackageSnapshot {
  const s = structuredClone(profile.sections);
  const ext = profile.photo?.ext;
  return {
    personal: s.personal.data,
    education: s.education.data.items,
    experience: s.experience.data.items,
    skills: s.skills.data.items,
    languages: s.languages.data.items,
    photo: ext === '.jpg' || ext === '.png' ? ext : null,
  };
}

/** Changes when anything the CV is built from changes (the five sections' data and the photo) — spec, self-review 3. */
export function profileFingerprint(profile: Profile): string {
  const s = profile.sections;
  const input = {
    personal: s.personal.data, education: s.education.data, experience: s.experience.data,
    skills: s.skills.data, languages: s.languages.data, photo: profile.photo?.id ?? null,
  };
  return crypto.createHash('sha256').update(stable(input)).digest('hex');
}

const descriptions = (s: PackageSnapshot) =>
  stable(Object.fromEntries([...s.education, ...s.experience].map((e) => [e.id, e.description.trim()])));
const skillIds = (s: PackageSnapshot) => stable(s.skills.map((k) => k.id).sort());

/** "Update CV" needs Claude only when descriptions or the set of skills changed (spec, section 1). */
export function sameCvInputs(a: PackageSnapshot, b: PackageSnapshot): boolean {
  return descriptions(a) === descriptions(b) && skillIds(a) === skillIds(b);
}
