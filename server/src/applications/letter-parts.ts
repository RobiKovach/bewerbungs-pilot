import type { DocLanguage, PackageVacancy, Profile, VacancyContact } from '@bp/shared';

const TITLES = /^(Dr\.|Prof\.)$/;

/** "Dr. Jan Berg" → "Dr. Berg"; "Anna Müller" → "Müller". */
function titledLastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const titles = parts.filter((p) => TITLES.test(p));
  const rest = parts.filter((p) => !TITLES.test(p));
  return [...titles, rest[rest.length - 1] ?? ''].filter(Boolean).join(' ');
}

/** Company, contact person, then the contact's postal address when known — otherwise the first place of work. */
export function buildRecipient(v: PackageVacancy): string[] {
  const c = v.contact;
  const person = c && c.name.trim() ? [c.salutation, c.name.trim()].filter(Boolean).join(' ') : '';
  const street = c?.street.trim() ?? '';
  const place = c ? [c.postcode.trim(), c.city.trim()].filter(Boolean).join(' ') : '';
  const address = street || place ? [street, place] : [v.locations[0]?.trim() ?? ''];
  return [v.company.trim(), person, ...address].filter(Boolean);
}

export function buildSalutation(contact: VacancyContact | null, lang: DocLanguage): string {
  const known = contact && contact.name.trim() && contact.salutation ? contact : null;
  if (lang === 'en') {
    if (!known) return 'Dear Hiring Team,';
    const nameWithTitle = titledLastName(known.name);
    const hasTitle = TITLES.test(nameWithTitle.split(/\s+/)[0]);
    const prefix = hasTitle ? '' : (known.salutation === 'Frau' ? 'Ms ' : 'Mr ');
    return `Dear ${prefix}${nameWithTitle},`;
  }
  if (!known) return 'Sehr geehrte Damen und Herren,';
  return `${known.salutation === 'Frau' ? 'Sehr geehrte Frau' : 'Sehr geehrter Herr'} ${titledLastName(known.name)},`;
}

export function closingFor(lang: DocLanguage): string {
  return lang === 'en' ? 'Kind regards' : 'Mit freundlichen Grüßen';
}

/** One sentence about working from home when the offer is elsewhere and the person wants remote/hybrid work. */
export function mentionHomeOffice(profile: Profile, v: PackageVacancy): boolean {
  const city = normaliseCity(profile.sections.personal.data.city);
  const remote = profile.sections.wishes.data.remote;
  if (!city || (remote !== 'remote' && remote !== 'hybrid')) return false;
  const wholeWord = new RegExp(`(^|[^\\p{L}])${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u');
  return !v.locations.some((l) => wholeWord.test(normaliseCity(l)));
}

/** "01067 Dresden, Sachsen" / "Dresden (Neustadt)" → "dresden": lowercase, NFC, no digits, only the text before a comma or bracket. */
function normaliseCity(raw: string): string {
  return raw.normalize('NFC').toLowerCase().split(/[,(]/)[0].replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
}
