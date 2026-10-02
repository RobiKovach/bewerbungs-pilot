import type { DocLanguage, Profile } from '@bp/shared';

export interface PackageContext {
  language: DocLanguage;
  city: string;
  mentionHomeOffice: boolean;
  education: { id: string; kind: string; degree: string; institution: string; city: string; from: string; to: string; description: string }[];
  experience: { id: string; jobTitle: string; employer: string; city: string; from: string; to: string; description: string }[];
  skills: { id: string; name: string }[];
  languages: { language: string; level: string; certificate: string }[];
  stories: { id: string; title: string; text: string; kind: string }[];
  neverMention: string[];
}

export interface LetterOutput { subject: string; paragraphs: string[]; storyIds: string[]; hint: string | null }
export interface CvOutput { profil: string; descriptions: { id: string; text: string }[]; skillOrder: string[] }
export type CreateOutput = LetterOutput & CvOutput;

/**
 * What Claude may know to write a package (spec, section 3): CV data, the city (for the Home Office sentence), confirmed
 * stories that may be told, "never mention". Never name, e-mail, phone, street, postal code, birth date, nationality,
 * work permit, driving licence, photo or untellable/unconfirmed stories — the server fills the letter's contact parts.
 */
export function packageContext(profile: Profile, language: DocLanguage, mentionHomeOffice: boolean): PackageContext {
  const s = profile.sections;
  return {
    language,
    city: s.personal.data.city,
    mentionHomeOffice,
    education: s.education.data.items.map((e) => ({ id: e.id, kind: e.kind, degree: e.degree, institution: e.institution, city: e.city, from: e.from, to: e.to, description: e.description })),
    experience: s.experience.data.items.map((e) => ({ id: e.id, jobTitle: e.jobTitle, employer: e.employer, city: e.city, from: e.from, to: e.to, description: e.description })),
    skills: s.skills.data.items.map((k) => ({ id: k.id, name: k.name })),
    languages: s.languages.data.items.map((l) => ({ language: l.language, level: l.level, certificate: l.certificate })),
    stories: profile.stories.filter((st) => st.confirmed && st.disclosure === 'ok').map((st) => ({ id: st.id, title: st.title, text: st.text, kind: st.kind })),
    neverMention: profile.neverMention.map((m) => m.trim()).filter(Boolean),
  };
}
