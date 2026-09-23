import { describe, it, expect } from 'vitest';
import { AppError, httpStatusFor } from '../src/errors.js';

describe('AppError', () => {
  it('keeps code and log details', () => {
    const err = new AppError('LLM_TIMEOUT', 'no answer');
    expect(err.code).toBe('LLM_TIMEOUT');
    expect(err.detailsForLog).toBe('no answer');
    expect(err).toBeInstanceOf(Error);
  });
  it('maps codes to HTTP statuses', () => {
    expect(httpStatusFor('BAD_REQUEST')).toBe(400);
    expect(httpStatusFor('NOT_FOUND')).toBe(404);
    expect(httpStatusFor('CLAUDE_NOT_LOGGED_IN')).toBe(503);
    expect(httpStatusFor('LLM_TIMEOUT')).toBe(504);
    expect(httpStatusFor('LLM_CANCELLED')).toBe(499);
    expect(httpStatusFor('UNKNOWN')).toBe(500);
  });
});
