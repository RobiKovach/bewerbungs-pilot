import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { migrate } from '../src/data/migrate.js';
import { emptyProfile, PROFILE_MIGRATIONS, PROFILE_SCHEMA_VERSION, validateProfile, validateSectionData } from '../src/profile/schema.js';
import { ProfileStore } from '../src/profile/store.js';
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
  it('migrates an open personal CV proposal of a v3 profile too, so the file is not set aside', () => {
    const v4 = emptyProfile();
    const { links: _drop, ...oldPersonal } = v4.sections.personal.data;
    void _drop;
    const proposal = { ...oldPersonal, fullName: 'Max Neu' };
    const v3 = {
      ...v4, schemaVersion: 3, cvProposals: { personal: proposal },
      sections: { ...v4.sections, personal: { ...v4.sections.personal, data: oldPersonal } },
    };
    const doc = migrate(v3, PROFILE_SCHEMA_VERSION, PROFILE_MIGRATIONS) as unknown as typeof v4;
    expect(validateProfile(doc)).toBeNull();
    expect(doc.cvProposals).toEqual({ personal: { ...proposal, links: [] } });
    expect(doc.sections).toEqual(v4.sections);
  });
  it('a v3 file with an open personal proposal loads without being set aside', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-links-'));
    const file = path.join(dir, 'profile.json');
    const v4 = emptyProfile();
    const { links: _drop, ...oldPersonal } = v4.sections.personal.data;
    void _drop;
    fs.writeFileSync(file, JSON.stringify({
      ...v4, schemaVersion: 3, neverMention: ['Kunde X'], cvProposals: { personal: { ...oldPersonal, fullName: 'Max Neu' } },
      sections: { ...v4.sections, personal: { ...v4.sections.personal, data: oldPersonal } },
    }));
    const events: string[] = [];
    const loaded = new ProfileStore(file, (e) => events.push(e)).load();
    expect(events).toEqual([]);
    expect(loaded.neverMention).toEqual(['Kunde X']);
    expect(loaded.cvProposals.personal).toMatchObject({ fullName: 'Max Neu', links: [] });
    expect(fs.readdirSync(dir)).toEqual(['profile.json']);
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
