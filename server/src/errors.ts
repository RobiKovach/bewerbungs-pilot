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
    case 'NO_SESSION': return 401;
    case 'LLM_CANCELLED': return 499;
    case 'LLM_NOT_INSTALLED':
    case 'LLM_NOT_LOGGED_IN': return 503;
    case 'LLM_LIMIT': return 429;
    case 'LLM_NOT_CHOSEN': return 409;
    case 'CV_NO_TEXT': return 422;
    case 'LLM_TIMEOUT': return 504;
    case 'FILE_TOO_LARGE': return 413;
    case 'FILE_TYPE_NOT_ALLOWED': return 415;
    case 'TOO_MANY_FILES':
    case 'CONFLICT':
    case 'PROFILE_NOT_READY': return 409;
    case 'CV_UNREADABLE': return 422;
    case 'SOURCE_UNAVAILABLE': return 503;
    case 'SOURCE_RATE_LIMITED': return 429;
    case 'SOURCE_CHANGED': return 502;
    case 'SEARCH_ALREADY_RUNNING':
    case 'WISHES_INCOMPLETE':
    case 'VACANCY_DUPLICATE': return 409;
    case 'NOT_A_VACANCY': return 422;
    case 'VACANCY_NOT_FOUND': return 404;
    case 'BROWSER_MISSING': return 503;
    case 'LETTER_TOO_LONG':
    case 'PACKAGE_EXISTS': return 409;
    case 'PACKAGE_RULES_BROKEN':
    case 'MAIL_AUTH':
    case 'MAIL_REJECTED': return 502;
    case 'MAIL_NOT_CONFIGURED':
    case 'MAIL_REAUTH':
    case 'MAIL_SCOPE': return 409;
    case 'MAIL_CONNECT': return 503;
    default: return 500;
  }
}
