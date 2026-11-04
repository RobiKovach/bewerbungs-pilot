import { describe, it, expect } from 'vitest';
import type { InterviewPrep } from '@bp/shared';
import { answersFingerprint, chancePercent } from '../src/interview/chance.js';

function prep(text = 'Ich habe mit React gearbeitet.', updatedAt = '2026-11-04T10:00:00.000Z', dontKnow = false): InterviewPrep {
  return {
    schemaVersion: 1, applicationId: 'app-1', language: 'de', createdAt: '2026-11-04T09:00:00.000Z', updatedAt,
    questions: [
      { id: 'q1', kind: 'experience', text: 'Erzählen Sie etwas über sich', code: null, answer: { text, dontKnow, updatedAt, feedback: null } },
      { id: 'q2', kind: 'theory', text: 'var, let und const?', code: null, answer: null },
    ],
    employerQuestions: [], summary: null,
  };
}

describe('chancePercent', () => {
  it('caps by the weak answers, stays within 5–95 and rounds down to a multiple of 5', () => {
    expect(chancePercent(85, 4, 9)).toBe(55);
    expect(chancePercent(85, 9, 9)).toBe(10);
    expect(chancePercent(63, 0, 9)).toBe(60);
    expect(chancePercent(99, 0, 9)).toBe(95);
    expect(chancePercent(2, 0, 9)).toBe(5);
  });

  it('keeps a value below the cap and an exact multiple of 5 as it is', () => {
    expect(chancePercent(40, 4, 9)).toBe(40);
    expect(chancePercent(95, 0, 9)).toBe(95);
  });

  it('a value that is not a number, or an empty set, gives the lowest honest figure', () => {
    expect(chancePercent(Number.NaN, 0, 9)).toBe(5);
    expect(chancePercent(80, 0, 0)).toBe(10);
  });
});

describe('answersFingerprint', () => {
  it('is the same for the same answers', () => {
    expect(answersFingerprint(prep())).toBe(answersFingerprint(prep()));
    expect(answersFingerprint(prep())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the text or "I don\'t know" changes', () => {
    expect(answersFingerprint(prep('Anders.'))).not.toBe(answersFingerprint(prep()));
    expect(answersFingerprint(prep(undefined, undefined, true))).not.toBe(answersFingerprint(prep()));
  });

  it('does not change with updatedAt', () => {
    expect(answersFingerprint(prep(undefined, '2030-01-01T00:00:00.000Z'))).toBe(answersFingerprint(prep()));
  });

  it('an answered question differs from an unanswered one, and texts cannot blend across questions', () => {
    const empty = prep('');
    empty.questions[0]!.answer = null;
    expect(answersFingerprint(empty)).not.toBe(answersFingerprint(prep('')));
    const a = prep('a');
    a.questions[1]!.answer = { text: 'b', dontKnow: false, updatedAt: a.updatedAt, feedback: null };
    const b = prep('ab');
    b.questions[1]!.answer = { text: '', dontKnow: false, updatedAt: b.updatedAt, feedback: null };
    expect(answersFingerprint(a)).not.toBe(answersFingerprint(b));
  });
});
