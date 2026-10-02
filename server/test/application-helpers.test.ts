import { describe, it, expect } from 'vitest';
import type { PackageVacancy, Profile } from '@bp/shared';
import { detectLanguage, englishBelowB2 } from '../src/applications/language.js';
import { buildRecipient, buildSalutation, closingFor, mentionHomeOffice } from '../src/applications/letter-parts.js';
import { profileFingerprint, sameCvInputs, takeSnapshot } from '../src/applications/snapshot.js';
import { emptyProfile } from '../src/profile/schema.js';

const DE = 'Wir suchen für unser Team in Berlin einen Webentwickler (m/w/d). Sie arbeiten mit React und die Arbeit ist spannend. Wir bieten Ihnen ein tolles Team.';
const EN = 'We are looking for a web developer to join our team. You will work with React and the product team. We offer a great team and you get flexible hours.';

describe('detectLanguage', () => {
  it('German offer → de, English offer → en', () => {
    expect(detectLanguage(DE)).toBe('de');
    expect(detectLanguage(EN)).toBe('en');
  });
  it('empty or undecided text → de (the German market default)', () => {
    expect(detectLanguage('')).toBe('de');
    expect(detectLanguage('React TypeScript Node.js')).toBe('de');
  });
  it('an English offer with a few German words is still English', () => {
    expect(detectLanguage(`${EN} Standort: Berlin, Vollzeit.`)).toBe('en');
  });
});

describe('englishBelowB2', () => {
  const lang = (language: string, level: '' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'native') => ({ id: language, language, level, certificate: '' });
  it.each([
    [[lang('Englisch', 'B1')], true],
    [[lang('English', 'B2')], false],
    [[lang('Англійська', 'C1')], false],
    [[lang('angielski', 'A2')], true],
    [[lang('Englisch', '')], true],
    [[lang('Deutsch', 'native')], true],
    [[], true],
  ] as const)('%j → %s', (items, expected) => {
    expect(englishBelowB2([...items])).toBe(expected);
  });
});

function profile(change: (p: Profile) => void = () => {}): Profile {
  const p = emptyProfile();
  p.sections.personal.data.city = 'Dresden';
  p.sections.experience.data.items = [{ id: 'e1', jobTitle: 'Webentwickler', employer: 'Beispiel GmbH', city: 'Dresden', country: 'DE', from: '2018-07', to: '', description: 'Kundenwebseiten gebaut.' }];
  p.sections.skills.data.items = [{ id: 'k1', name: 'JavaScript', level: 'good' }, { id: 'k2', name: 'WordPress', level: '' }];
  change(p);
  return p;
}

describe('snapshot and fingerprint', () => {
  it('snapshot copies the five sections and the photo extension', () => {
    const s = takeSnapshot(profile((p) => { p.photo = { id: 'f1', ext: '.jpg', originalName: 'a.jpg', size: 1, uploadedAt: 'x' }; }));
    expect(s.personal.city).toBe('Dresden');
    expect(s.experience[0].id).toBe('e1');
    expect(s.skills.map((k) => k.id)).toEqual(['k1', 'k2']);
    expect(s.photo).toBe('.jpg');
  });
  it('the fingerprint changes with CV data and the photo, not with stories, wishes or confirmation', () => {
    const base = profileFingerprint(profile());
    expect(profileFingerprint(profile())).toBe(base);
    expect(profileFingerprint(profile((p) => { p.stories = [{ id: 's', title: 't', text: 'x', kind: 'work', disclosure: 'ok', confirmed: true }]; }))).toBe(base);
    expect(profileFingerprint(profile((p) => { p.sections.wishes.data.jobTitles = ['X']; }))).toBe(base);
    expect(profileFingerprint(profile((p) => { p.sections.skills.confirmedAt = '2026-09-29T10:00:00.000Z'; }))).toBe(base);
    expect(profileFingerprint(profile((p) => { p.sections.experience.data.items[0].description = 'Anders.'; }))).not.toBe(base);
    expect(profileFingerprint(profile((p) => { p.photo = { id: 'f2', ext: '.png', originalName: 'b.png', size: 1, uploadedAt: 'x' }; }))).not.toBe(base);
  });
  it('sameCvInputs: equal descriptions and skill ids → true; a changed description or a new skill → false; a new phone number → true', () => {
    const a = takeSnapshot(profile());
    expect(sameCvInputs(a, takeSnapshot(profile((p) => { p.sections.personal.data.phone = '+49 1'; })))).toBe(true);
    expect(sameCvInputs(a, takeSnapshot(profile((p) => { p.sections.experience.data.items[0].description = 'Neu.'; })))).toBe(false);
    expect(sameCvInputs(a, takeSnapshot(profile((p) => { p.sections.skills.data.items.push({ id: 'k3', name: 'PHP', level: '' }); })))).toBe(false);
  });
});

const vac = (over: Partial<PackageVacancy> = {}): PackageVacancy => ({
  id: 'v1', title: 'Webentwickler (m/w/d)', company: 'Muster GmbH', locations: ['Berlin'], remote: 'partial', contact: null, url: '', ...over,
});

describe('letter parts', () => {
  it('recipient: company, contact line when a name is known, first location', () => {
    expect(buildRecipient(vac())).toEqual(['Muster GmbH', 'Berlin']);
    expect(buildRecipient(vac({ contact: { email: 'a@b.de', salutation: 'Frau', name: 'Anna Müller' } }))).toEqual(['Muster GmbH', 'Frau Anna Müller', 'Berlin']);
    expect(buildRecipient(vac({ locations: [], contact: { email: '', salutation: '', name: 'Kim Berg' } }))).toEqual(['Muster GmbH', 'Kim Berg']);
  });
  it.each([
    [null, 'de', 'Sehr geehrte Damen und Herren,'],
    [{ email: '', salutation: 'Frau', name: 'Anna Müller' }, 'de', 'Sehr geehrte Frau Müller,'],
    [{ email: '', salutation: 'Herr', name: 'Dr. Jan Berg' }, 'de', 'Sehr geehrter Herr Dr. Berg,'],
    [{ email: '', salutation: '', name: 'Kim Berg' }, 'de', 'Sehr geehrte Damen und Herren,'],
    [null, 'en', 'Dear Hiring Team,'],
    [{ email: '', salutation: 'Frau', name: 'Anna Müller' }, 'en', 'Dear Ms Müller,'],
    [{ email: '', salutation: 'Herr', name: 'Prof. Jan Berg' }, 'en', 'Dear Prof. Berg,'],
    [{ email: '', salutation: 'Frau', name: 'Dr. Anna Müller' }, 'en', 'Dear Dr. Müller,'],
  ] as const)('salutation for %j in %s', (contact, lang, expected) => {
    expect(buildSalutation(contact, lang)).toBe(expected);
  });
  it('closing by language', () => {
    expect(closingFor('de')).toBe('Mit freundlichen Grüßen');
    expect(closingFor('en')).toBe('Kind regards');
  });
  it('Home Office sentence only when the offer is not in the person\'s city and they want remote or hybrid work', () => {
    const p = (remote: 'any' | 'onsite' | 'hybrid' | 'remote') => profile((x) => { x.sections.wishes.data.remote = remote; });
    expect(mentionHomeOffice(p('remote'), vac())).toBe(true);
    expect(mentionHomeOffice(p('hybrid'), vac())).toBe(true);
    expect(mentionHomeOffice(p('any'), vac())).toBe(false);
    expect(mentionHomeOffice(p('remote'), vac({ locations: ['dresden'] }))).toBe(false);
    expect(mentionHomeOffice(profile((x) => { x.sections.wishes.data.remote = 'remote'; x.sections.personal.data.city = ''; }), vac())).toBe(false);
  });
});
