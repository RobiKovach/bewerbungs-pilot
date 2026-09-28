import { describe, it, expect } from 'vitest';
import { findDuplicate, normalizeCompany, normalizeTitle, pairKey } from '../src/vacancies/dedup.js';
import { filterHits, isStudent } from '../src/vacancies/filter.js';
import { hit, profileWithWishes, vacancy } from './helpers/vacancies.js';

describe('normalize', () => {
  it.each([
    ['Frontend Developer (m/w/d)', 'frontend developer'],
    ['Frontend-Developer (w/m/d)', 'frontend developer'],
    ['Webentwickler*in (m|w|d)', 'webentwickler'],
    ['Webentwickler:in', 'webentwickler'],
    ['Webentwickler/-in', 'webentwickler'],
    ['Webentwickler (all genders)', 'webentwickler'],
    ['  Größen-Planer  (gn) ', 'größen planer'],
  ])('title %s → %s', (raw, out) => { expect(normalizeTitle(raw)).toBe(out); });
  it.each([
    ['Muster GmbH', 'muster'],
    ['Muster GmbH & Co. KG', 'muster'],
    ['MUSTER gmbh', 'muster'],
    ['Beispiel AG', 'beispiel'],
    ['Müller UG (haftungsbeschränkt)', 'müller'],
    ['Agentur Sonnenschein e.K.', 'agentur sonnenschein'],
  ])('company %s → %s', (raw, out) => { expect(normalizeCompany(raw)).toBe(out); });
  it('no pair key without a company or a title', () => {
    expect(pairKey('', 'Webentwickler')).toBeNull();
    expect(pairKey('GmbH', 'Webentwickler')).toBeNull();
    expect(pairKey('Muster GmbH', '(m/w/d)')).toBeNull();
    expect(pairKey('Muster GmbH', 'Webentwickler (m/w/d)')).toBe('muster|webentwickler');
  });
});

describe('findDuplicate', () => {
  const existing = [
    vacancy({ id: 'a', sourceId: 'R-1', company: 'Muster GmbH', title: 'Frontend Developer (m/w/d)' }),
    vacancy({ id: 'b', source: 'manual', sourceId: null, company: 'Beispiel AG', title: 'Webentwickler*in', status: 'hidden' }),
  ];
  it('matches by source number', () => {
    expect(findDuplicate(existing, { sourceId: 'R-1', company: 'Other', title: 'Other' })?.id).toBe('a');
  });
  it('matches by company + title, also against hidden ones', () => {
    expect(findDuplicate(existing, { sourceId: 'R-9', company: 'Muster GmbH & Co. KG', title: 'Frontend-Developer (w/m/d)' })?.id).toBe('a');
    expect(findDuplicate(existing, { sourceId: null, company: 'beispiel ag', title: 'Webentwickler (m/w/d)' })?.id).toBe('b');
  });
  it('does not match a different title at the same company, nor two empty companies', () => {
    expect(findDuplicate(existing, { sourceId: 'R-9', company: 'Muster GmbH', title: 'Backend Developer' })).toBeUndefined();
    const noCompany = [vacancy({ id: 'c', sourceId: null, company: '', title: 'Webentwickler' })];
    expect(findDuplicate(noCompany, { sourceId: null, company: '', title: 'Webentwickler' })).toBeUndefined();
  });
});

describe('isStudent', () => {
  const uni = (to: string) => profileWithWishes({}, (p) => {
    p.sections.education.data.items = [{ id: 'e1', kind: 'university', degree: 'B.Sc. Informatik', institution: 'TU Dresden', city: '', country: '', from: '2023', to, description: '' }];
  });
  it('an unfinished university entry = student; a finished one or none = not', () => {
    expect(isStudent(uni(''))).toBe(true);
    expect(isStudent(uni('2025'))).toBe(false);
    expect(isStudent(profileWithWishes({}))).toBe(false);
  });
});

describe('filterHits', () => {
  const base = profileWithWishes({ jobTitles: ['Webentwickler'], locations: ['Dresden'], employmentTypes: ['fulltime'] });

  it('drops what is already known (any status) and duplicates inside the batch, as "seen"', () => {
    const known = vacancy({ sourceId: 'R-1' });
    const hidden = vacancy({ sourceId: 'R-2', status: 'hidden', company: 'Muster GmbH', title: 'Webentwickler' });
    const fresh = hit({ sourceId: 'R-3', company: 'Neu AG', title: 'Webentwickler' });
    const copy = hit({ sourceId: 'R-4', company: 'Neu AG', title: 'Webentwickler (m/w/d)' });
    const r = filterHits([hit({ sourceId: 'R-1' }), hit({ sourceId: 'R-5', company: 'Muster GmbH', title: 'Webentwickler (m/w/d)' }), fresh, copy], base, [known, hidden]);
    expect(r.passed.map((h) => h.sourceId)).toEqual(['R-3']);
    expect(r.rejected.map((x) => x.reason)).toEqual(['seen', 'seen', 'seen']);
  });

  it('"remote only" keeps only offers with home office', () => {
    const p = profileWithWishes({ jobTitles: ['Webentwickler'], remote: 'remote' });
    const r = filterHits([hit({ remote: 'yes' }), hit({ remote: 'partial' }), hit({ remote: 'no' }), hit({ remote: 'unknown' })], p, []);
    expect(r.passed.map((h) => h.remote)).toEqual(['yes', 'partial']);
    expect(r.rejected.map((x) => x.reason)).toEqual(['notRemote', 'notRemote']);
  });

  it('other remote wishes do not filter by home office', () => {
    for (const remote of ['any', 'onsite', 'hybrid'] as const) {
      const p = profileWithWishes({ jobTitles: ['Webentwickler'], locations: ['Dresden'], remote });
      expect(filterHits([hit({ remote: 'no' })], p, []).passed).toHaveLength(1);
    }
  });

  it('student formats only for students', () => {
    const titles = ['Werkstudent Webentwicklung (m/w/d)', 'Werkstudentin Frontend', 'Studentische Hilfskraft IT', 'Abschlussarbeit Web', 'Masterarbeit: React'];
    const r = filterHits(titles.map((title) => hit({ title })), base, []);
    expect(r.passed).toEqual([]);
    expect(new Set(r.rejected.map((x) => x.reason))).toEqual(new Set(['student']));
    const student = profileWithWishes({ jobTitles: ['Webentwickler'] }, (p) => {
      p.sections.education.data.items = [{ id: 'e1', kind: 'university', degree: 'B.Sc.', institution: 'TU', city: '', country: '', from: '2024', to: '', description: '' }];
    });
    expect(filterHits([hit({ title: 'Werkstudent Web (m/w/d)' })], student, []).passed).toHaveLength(1);
  });

  it('internships and apprenticeships only when wished; "praktische Erfahrung" is not an internship', () => {
    const hits = [
      hit({ title: 'Praktikum Webentwicklung' }), hit({ title: 'Praktikant*in Frontend' }), hit({ title: 'Pflichtpraktikum IT' }),
      hit({ title: 'Ausbildung zum Fachinformatiker (m/w/d)' }), hit({ title: 'Duales Studium Informatik' }),
      hit({ title: 'Fachinformatiker Ausbildung 2027' }), hit({ title: 'Auszubildende/r Kauffrau für Büromanagement' }),
      hit({ title: 'Webentwickler mit praktischer Erfahrung' }),
    ];
    const r = filterHits(hits, base, []);
    expect(r.passed.map((h) => h.title)).toEqual(['Webentwickler mit praktischer Erfahrung']);
    expect(r.rejected.map((x) => x.reason)).toEqual(['internship', 'internship', 'internship', 'apprenticeship', 'apprenticeship', 'apprenticeship', 'apprenticeship']);
    const wantsBoth = profileWithWishes({ jobTitles: ['Webentwickler'], employmentTypes: ['internship', 'apprenticeship'] });
    expect(filterHits(hits, wantsBoth, []).passed).toHaveLength(8);
  });

  it('"Ausbildung" as a qualification, not the offer kind, does not count as apprenticeship', () => {
    const hits = [
      hit({ title: 'Fachinformatiker (abgeschlossene Ausbildung)' }),
      hit({ title: 'Webentwickler mit abgeschlossener Ausbildung' }),
      hit({ title: 'IT-Systemadministrator (Ausbildung wünschenswert)' }),
    ];
    expect(filterHits(hits, base, []).passed).toHaveLength(3);
  });
});
