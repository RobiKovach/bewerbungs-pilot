export type ErrorCode =
  | 'CLAUDE_NOT_INSTALLED'
  | 'CLAUDE_NOT_LOGGED_IN'
  | 'LLM_TIMEOUT'
  | 'LLM_BAD_OUTPUT'
  | 'LLM_FAILED'
  | 'LLM_CANCELLED'
  | 'DATA_WRITE_FAILED'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly detailsForLog = '',
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
    default: return 500;
  }
}
