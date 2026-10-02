import type { ApplicationPackage, Profile } from '@bp/shared';
import { profileFingerprint, takeSnapshot } from '../../src/applications/snapshot.js';
import { emptyProfile } from '../../src/profile/schema.js';

const NOW = '2026-09-29T10:00:00.000Z';

/** Max Mustermann with everything a package needs: five confirmed sections and one tellable story. */
export function readyPackageProfile(change: (p: Profile) => void = () => {}): Profile {
  const p = emptyProfile();
  p.sections.personal.data = {
    ...p.sections.personal.data, fullName: 'Max Mustermann', email: 'max@example.com', phone: '+49 30 1234567',
    street: 'Musterstraße 1', postalCode: '10115', city: 'Berlin', country: 'Deutschland',
  };
  p.sections.education.data.items = [{ id: 'ed1', kind: 'vocational', degree: 'Fachinformatiker für Anwendungsentwicklung', institution: 'OSZ IMT Berlin', city: 'Berlin', country: 'Deutschland', from: '2015-09', to: '2018-06', description: 'Ausbildung mit Schwerpunkt Web.' }];
  p.sections.experience.data.items = [{ id: 'ex1', jobTitle: 'Webentwickler', employer: 'Beispiel GmbH', city: 'Berlin', country: 'Deutschland', from: '2018-07', to: '', description: 'Kundenwebseiten entwickelt.' }];
  p.sections.skills.data.items = [
    { id: 'sk1', name: 'JavaScript', level: 'good' }, { id: 'sk2', name: 'WordPress', level: '' },
    { id: 'sk3', name: 'CSS', level: 'expert' }, { id: 'sk4', name: 'PHP', level: 'basic' }, { id: 'sk5', name: 'Git', level: '' },
  ];
  p.sections.languages.data.items = [{ id: 'la1', language: 'Deutsch', level: 'native', certificate: '' }, { id: 'la2', language: 'Englisch', level: 'B2', certificate: '' }];
  for (const id of ['personal', 'education', 'experience', 'skills', 'languages'] as const) p.sections[id].confirmedAt = NOW;
  p.stories = [
    { id: 'st1', title: 'Online-Shop', text: 'Für einen Bäcker einen Online-Shop gebaut, Bestellungen stiegen.', kind: 'client', disclosure: 'ok', confirmed: true },
    { id: 'st2', title: 'Geheim', text: 'Projekt für Kunde X unter NDA.', kind: 'client', disclosure: 'never', confirmed: true },
  ];
  p.neverMention = ['Kunde X'];
  change(p);
  return p;
}

let n = 0;
/** A valid package for Max Mustermann; every call gets a new id unless one is given. */
export function pkg(over: Partial<ApplicationPackage> = {}, profile: Profile = readyPackageProfile()): ApplicationPackage {
  n++;
  return {
    schemaVersion: 1, id: `a${n}`, vacancyId: `v${n}`, language: 'de', status: 'draft', createdAt: NOW, updatedAt: NOW, approvedAt: null,
    profileFingerprint: profileFingerprint(profile), snapshot: takeSnapshot(profile),
    vacancy: { id: `v${n}`, title: 'Webentwickler (m/w/d)', company: 'Muster GmbH', locations: ['Berlin'], remote: 'partial', contact: null, url: '' },
    letter: {
      recipient: ['Muster GmbH', 'Berlin'], subject: 'Bewerbung als Webentwickler (m/w/d)', salutation: 'Sehr geehrte Damen und Herren,',
      paragraphs: ['Absatz eins.', 'Absatz zwei.', 'Absatz drei.'], closing: 'Mit freundlichen Grüßen', signature: 'Max Mustermann',
      storyIds: ['st1'], hint: null, pages: 1,
    },
    cv: { profil: 'Webentwickler mit sechs Jahren Erfahrung.', profilEditedByHand: false, descriptions: { ed1: 'Ausbildung mit Schwerpunkt Web.', ex1: 'Kundenwebseiten entwickelt.' }, skillOrder: ['sk1', 'sk2', 'sk3', 'sk4', 'sk5'] },
    attachments: [],
    ...over,
  };
}
