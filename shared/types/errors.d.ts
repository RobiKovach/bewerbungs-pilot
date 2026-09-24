/** Codes the server sends as { error: { code, detailsForLog } }. The web client adds its own SERVER_UNREACHABLE. */
export type ErrorCode =
  | 'CLAUDE_NOT_INSTALLED'
  | 'CLAUDE_NOT_LOGGED_IN'
  | 'LLM_TIMEOUT'
  | 'LLM_BAD_OUTPUT'
  | 'LLM_FAILED'
  | 'LLM_CANCELLED'
  | 'DATA_WRITE_FAILED'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'TOO_MANY_FILES'
  | 'CV_UNREADABLE'
  | 'PROFILE_NOT_READY'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'UNKNOWN';
