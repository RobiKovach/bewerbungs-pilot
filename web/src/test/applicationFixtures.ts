import type { ApplicationJobState, ApplicationPackage, ApplicationSummary, ApplicationView } from '../types';

const NOW = '2026-09-29T10:00:00.000Z';
export function appPackage(over: Partial<ApplicationPackage> = {}): ApplicationPackage {
  return {
    schemaVersion: 1, id: 'app1', vacancyId: 'v1', language: 'de', status: 'draft', createdAt: NOW, updatedAt: NOW, approvedAt: null,
    profileFingerprint: '0'.repeat(64),
    snapshot: {
      personal: { fullName: 'Max Mustermann', email: 'max@example.com', phone: '', street: '', postalCode: '10115', city: 'Berlin', country: '', birthDate: '', nationality: '', workPermit: '', drivingLicense: '' },
      education: [], experience: [], skills: [{ id: 'sk1', name: 'JavaScript', level: 'good' }], languages: [], photo: null,
    },
    vacancy: { id: 'v1', title: 'Webentwickler (m/w/d)', company: 'Muster GmbH', locations: ['Hamburg'], remote: 'partial', contact: null, url: '' },
    letter: {
      recipient: ['Muster GmbH', 'Hamburg'], subject: 'Bewerbung als Webentwickler (m/w/d)', salutation: 'Sehr geehrte Damen und Herren,',
      paragraphs: ['Absatz eins.', 'Absatz zwei.', 'Absatz drei.'], closing: 'Mit freundlichen Grüßen', signature: 'Max Mustermann',
      storyIds: ['st1'], hint: null, pages: 1,
    },
    cv: { profil: 'Webentwickler mit Erfahrung.', profilEditedByHand: false, descriptions: {}, skillOrder: ['sk1'] },
    attachments: [],
    ...over,
  };
}
export function appView(over: Partial<ApplicationView> = {}, pkg: Partial<ApplicationPackage> = {}): ApplicationView {
  return { application: appPackage(pkg), profileChanged: false, attachments: [], ...over };
}
export function appSummary(over: Partial<ApplicationSummary & { profileChanged: boolean }> = {}): ApplicationSummary & { profileChanged: boolean } {
  return { id: 'app1', vacancyId: 'v1', company: 'Muster GmbH', title: 'Webentwickler (m/w/d)', language: 'de', status: 'draft', createdAt: NOW, updatedAt: NOW, approvedAt: null, profileChanged: false, ...over };
}
export function jobState(over: Partial<ApplicationJobState> = {}): ApplicationJobState {
  return { state: 'idle', kind: null, vacancyId: null, applicationId: null, error: null, startedAt: null, finishedAt: null, ...over };
}
