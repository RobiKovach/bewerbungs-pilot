import { describe, it, expect } from 'vitest';
import type { Profile } from '@bp/shared';
import { assertPackageReady, packageReadiness } from '../src/applications/readiness.js';
import { AppError } from '../src/errors.js';
import { emptyProfile } from '../src/profile/schema.js';

const NOW = '2026-09-29T10:00:00.000Z';
function profile(change: (p: Profile) => void = () => {}): Profile {
  const p = emptyProfile();
  for (const id of ['personal', 'education', 'experience', 'skills', 'languages'] as const) p.sections[id].confirmedAt = NOW;
  p.stories = [{ id: 's1', title: 'Shop', text: 'Built a shop.', kind: 'client', disclosure: 'ok', confirmed: true }];
  change(p);
  return p;
}

describe('packageReadiness', () => {
  it('ready with five confirmed sections and one confirmed tellable story; wishes are not needed', () => {
    expect(packageReadiness(profile())).toEqual({ ready: true, missingSections: [], noStory: false });
  });
  it('lists unconfirmed sections in profile order', () => {
    const r = packageReadiness(profile((p) => { p.sections.skills.confirmedAt = null; p.sections.personal.confirmedAt = null; }));
    expect(r).toEqual({ ready: false, missingSections: ['personal', 'skills'], noStory: false });
  });
  it.each([
    ['unconfirmed', { confirmed: false, disclosure: 'ok' }],
    ['never tell', { confirmed: true, disclosure: 'never' }],
  ] as const)('a story that is %s does not count', (_label, over) => {
    const r = packageReadiness(profile((p) => { p.stories = [{ ...p.stories[0], ...over }]; }));
    expect(r).toEqual({ ready: false, missingSections: [], noStory: true });
  });
});

describe('assertPackageReady', () => {
  it('missing sections → PROFILE_NOT_READY / profileMissing with the section list', () => {
    try {
      assertPackageReady(profile((p) => { p.sections.education.confirmedAt = null; }));
      throw new Error('no error');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ code: 'PROFILE_NOT_READY', reason: 'profileMissing', params: { sections: 'education' } });
    }
  });
  it('no story → PROFILE_NOT_READY / noStory', () => {
    expect(() => assertPackageReady(profile((p) => { p.stories = []; }))).toThrow(expect.objectContaining({ code: 'PROFILE_NOT_READY', reason: 'noStory' }));
  });
  it('ready → no error', () => {
    expect(() => assertPackageReady(profile())).not.toThrow();
  });
});
