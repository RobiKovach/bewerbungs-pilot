import type { ErrorCode, ErrorReason } from '@bp/shared';

export type { ErrorCode, ErrorReason };

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly detailsForLog = '',
    /** Machine-readable id for a translated, person-facing sentence (`errors.reasons.<reason>` in the locales). */
    public readonly reason?: ErrorReason,
    /** Small record of strings/numbers to interpolate into that sentence. */
    public readonly params?: Record<string, string | number>,
  ) {
    super(detailsForLog ? `${code}: ${detailsForLog}` : code);
    this.name = 'AppError';
  }
}

export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case 'BAD_REQUEST': return 400;
    case 'NOT_FOUND': return 404;
    case 'LLM_CANCELLED': return 499;
    case 'CLAUDE_NOT_INSTALLED':
    case 'CLAUDE_NOT_LOGGED_IN': return 503;
    case 'LLM_TIMEOUT': return 504;
    case 'FILE_TOO_LARGE': return 413;
    case 'FILE_TYPE_NOT_ALLOWED': return 415;
    case 'TOO_MANY_FILES':
    case 'CONFLICT':
    case 'PROFILE_NOT_READY': return 409;
    case 'CV_UNREADABLE': return 422;
    default: return 500;
  }
}
