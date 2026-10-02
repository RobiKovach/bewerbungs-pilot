import { describe, it, expect } from 'vitest';
import { migrate } from '../src/data/migrate.js';
import { emptyProfile, PROFILE_MIGRATIONS, PROFILE_SCHEMA_VERSION, validateProfile, validateSectionData } from '../src/profile/schema.js';
import { toSectionData } from '../src/profile/tasks/extract-cv.js';

const personal = (links: unknown) => ({ ...emptyProfile().sections.personal.data, fullName: 'Max Mustermann', links });

describe('profile v4 links', () => {
  it('schema version is 4 and an empty profile has no links', () => {
    expect(PROFILE_SCHEMA_VERSION).toBe(4);
    expect(emptyProfile().sections.personal.data.links).toEqual([]);
  });
  it('accepts up to 3 http(s) links', () => {
    expect(validateSectionData('personal', personal([{ label: 'GitHub', url: 'https://github.com/maxmuster' }, { label: 'Web', url: 'http://max.example' }]))).toBeNull();
  });
  it.each([
    ['javascript url', [{ label: 'x', url: 'javascript:alert(1)' }]],
    ['no protocol', [{ label: 'x', url: 'github.com/maxmuster' }]],
    ['empty label', [{ label: '', url: 'https://a.example' }]],
    ['label too long', [{ label: 'x'.repeat(41), url: 'https://a.example' }]],
    ['four links', Array.from({ length: 4 }, (_, i) => ({ label: `L${i}`, url: `https://a${i}.example` }))],
  ])('refuses %s', (_name, links) => {
    expect(validateSectionData('personal', personal(links))).not.toBeNull();
  });
  it('migrates a v3 profile by adding links: [] and nothing else', () => {
    const v4 = emptyProfile();
    const { links: _drop, ...oldPersonal } = v4.sections.personal.data;
    void _drop;
    const v3 = { ...v4, schemaVersion: 3, sections: { ...v4.sections, personal: { ...v4.sections.personal, data: oldPersonal } } };
    const doc = migrate(v3, PROFILE_SCHEMA_VERSION, PROFILE_MIGRATIONS);
    expect(validateProfile(doc)).toBeNull();
    expect(doc).toEqual(v4);
  });
  it('CV extraction keeps up to 3 valid links and drops bad ones', () => {
    let n = 0;
    const cv = {
      readable: true,
      personal: { ...personal([]), links: [
        { label: 'GitHub', url: 'https://github.com/maxmuster' }, { label: 'x', url: 'ftp://nope' },
        { label: 'LinkedIn', url: 'https://linkedin.com/in/maxmuster' }, { label: '', url: 'https://web.example' },
        { label: 'Blog', url: 'https://blog.example' }, { label: 'More', url: 'https://more.example' },
      ] },
      education: [], experience: [], skills: [], languages: [],
    };
    const data = toSectionData(cv, () => `id${n++}`);
    expect(data.personal.links).toEqual([
      { label: 'GitHub', url: 'https://github.com/maxmuster' },
      { label: 'LinkedIn', url: 'https://linkedin.com/in/maxmuster' },
      { label: 'Website', url: 'https://web.example' },
    ]);
  });
});
