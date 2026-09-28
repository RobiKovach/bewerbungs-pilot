import { describe, it, expect } from 'vitest';
import { AppError, httpStatusFor } from '../src/errors.js';

describe('AppError', () => {
  it('keeps code and log details', () => {
    const err = new AppError('LLM_TIMEOUT', 'no answer');
    expect(err.code).toBe('LLM_TIMEOUT');
    expect(err.detailsForLog).toBe('no answer');
    expect(err).toBeInstanceOf(Error);
  });
  it('accepts only known reason ids (a typo does not compile)', () => {
    expect(new AppError('TOO_MANY_FILES', 'x', 'tooManyDocuments').reason).toBe('tooManyDocuments');
    // @ts-expect-error — not one of the ErrorReason ids
    expect(new AppError('TOO_MANY_FILES', 'x', 'tooManyDocument').reason).toBe('tooManyDocument');
  });
  it('maps codes to HTTP statuses', () => {
    expect(httpStatusFor('BAD_REQUEST')).toBe(400);
    expect(httpStatusFor('NOT_FOUND')).toBe(404);
    expect(httpStatusFor('CLAUDE_NOT_LOGGED_IN')).toBe(503);
    expect(httpStatusFor('LLM_TIMEOUT')).toBe(504);
    expect(httpStatusFor('LLM_CANCELLED')).toBe(499);
    expect(httpStatusFor('UNKNOWN')).toBe(500);
  });
  it.each([
    ['FILE_TOO_LARGE', 413],
    ['FILE_TYPE_NOT_ALLOWED', 415],
    ['TOO_MANY_FILES', 409],
    ['CV_UNREADABLE', 422],
    ['PROFILE_NOT_READY', 409],
    ['CONFLICT', 409],
  ] as const)('maps %s to HTTP %i', (code, status) => {
    expect(httpStatusFor(code)).toBe(status);
  });
  it.each([
    ['SOURCE_UNAVAILABLE', 503],
    ['SOURCE_RATE_LIMITED', 429],
    ['SOURCE_CHANGED', 502],
    ['SEARCH_ALREADY_RUNNING', 409],
    ['WISHES_INCOMPLETE', 409],
    ['NOT_A_VACANCY', 422],
    ['VACANCY_DUPLICATE', 409],
    ['VACANCY_NOT_FOUND', 404],
  ] as const)('maps vacancy code %s to HTTP %i', (code, status) => {
    expect(httpStatusFor(code)).toBe(status);
  });
});
