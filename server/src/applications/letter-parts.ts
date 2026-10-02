import type { DocLanguage, PackageVacancy, Profile, VacancyContact } from '@bp/shared';

const TITLES = /^(Dr\.|Prof\.)$/;

/** "Dr. Jan Berg" → "Dr. Berg"; "Anna Müller" → "Müller". */
function titledLastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const titles = parts.filter((p) => TITLES.test(p));
  const rest = parts.filter((p) => !TITLES.test(p));
  return [...titles, rest[rest.length - 1] ?? ''].filter(Boolean).join(' ');
}

export function buildRecipient(v: PackageVacancy): string[] {
  const contact = v.contact && v.contact.name.trim() ? [v.contact.salutation, v.contact.name.trim()].filter(Boolean).join(' ') : '';
  return [v.company.trim(), contact, v.locations[0]?.trim() ?? ''].filter(Boolean);
}

export function buildSalutation(contact: VacancyContact | null, lang: DocLanguage): string {
  const known = contact && contact.name.trim() && contact.salutation ? contact : null;
  if (lang === 'en') {
    if (!known) return 'Dear Hiring Team,';
    return `Dear ${known.salutation === 'Frau' ? 'Ms' : 'Mr'} ${titledLastName(known.name)},`;
  }
  if (!known) return 'Sehr geehrte Damen und Herren,';
  return `${known.salutation === 'Frau' ? 'Sehr geehrte Frau' : 'Sehr geehrter Herr'} ${titledLastName(known.name)},`;
}

export function closingFor(lang: DocLanguage): string {
  return lang === 'en' ? 'Kind regards' : 'Mit freundlichen Grüßen';
}

/** One sentence about working from home when the offer is elsewhere and the person wants remote/hybrid work. */
export function mentionHomeOffice(profile: Profile, v: PackageVacancy): boolean {
  const city = profile.sections.personal.data.city.trim().toLowerCase();
  const remote = profile.sections.wishes.data.remote;
  if (!city || (remote !== 'remote' && remote !== 'hybrid')) return false;
  return !v.locations.some((l) => l.trim().toLowerCase() === city);
}
