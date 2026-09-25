import { describe, it, expect } from 'vitest';
import { reasonParams } from './errorReason';

const t = (key: string) => `<${key}>`;

describe('reasonParams', () => {
  it('turns the missing section ids into their titles', () => {
    expect(reasonParams('profileMissing', { sections: 'personal,,skills' }, t)).toEqual({
      sections: '<profile.sections.personal.title>, <profile.sections.skills.title>',
    });
  });

  it('adds the allowed file types for the upload kind', () => {
    expect(reasonParams('fileTypeDetected', { kind: 'photo', detected: '.pdf' }, t)).toEqual({
      kind: 'photo', detected: '.pdf', allowed: '<errors.reasons.allowedTypes.photo>',
    });
  });

  it('passes other params through unchanged and copes with none', () => {
    const params = { max: 20 };
    expect(reasonParams('tooManyDocuments', params, t)).toEqual({ max: 20 });
    expect(reasonParams('tooManyDocuments', params, t)).not.toBe(params);
    expect(reasonParams('cvNoContent', undefined, t)).toEqual({});
    expect(reasonParams('profileMissing', undefined, t)).toEqual({});
  });
});
