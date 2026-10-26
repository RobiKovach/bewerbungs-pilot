/** Codes the server sends as { error: { code, detailsForLog } }. The web client adds its own SERVER_UNREACHABLE. */
export type ErrorCode =
  | 'LLM_NOT_INSTALLED'
  | 'LLM_NOT_LOGGED_IN'
  | 'LLM_LIMIT'
  | 'LLM_NOT_CHOSEN'
  | 'CV_NO_TEXT'
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
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_RATE_LIMITED'
  | 'SOURCE_CHANGED'
  | 'SEARCH_ALREADY_RUNNING'
  | 'WISHES_INCOMPLETE'
  | 'NOT_A_VACANCY'
  | 'VACANCY_DUPLICATE'
  | 'VACANCY_NOT_FOUND'
  | 'BROWSER_MISSING'
  | 'LETTER_TOO_LONG'
  | 'PACKAGE_RULES_BROKEN'
  | 'PACKAGE_EXISTS'
  | 'MAIL_NOT_CONFIGURED'
  | 'MAIL_AUTH'
  | 'MAIL_CONNECT'
  | 'MAIL_REAUTH'
  | 'MAIL_SCOPE'
  | 'MAIL_REJECTED'
  /** A backup zip that is damaged, foreign or unsafe (paths outside the data folders, too big). */
  | 'BACKUP_INVALID'
  /** A backup made by a newer version of the app. */
  | 'BACKUP_NEWER'
  /** A backup could not be written (disk full, no access to the folder). */
  | 'BACKUP_FAILED'
  | 'CONFLICT'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  /** No launch key: the app was not opened via its shortcut (or it restarted since). */
  | 'NO_SESSION'
  | 'UNKNOWN';

/**
 * Ids of the translated, person-facing sentences an error may carry (`errors.reasons.<reason>` in the web locales).
 * One list for server and web, so a typo in either is a compile error.
 */
export type ErrorReason =
  | 'cvTooLittleText'
  | 'cvNoContent'
  | 'cvDocxBroken'
  | 'cvPdfBroken'
  | 'fileTypeDetected'
  | 'tooManyDocuments'
  | 'profileMissing'
  | 'llmTimeout'
  | 'cancelledByUser'
  | 'proposalChanged'
  | 'pastedTooShort'
  | 'offerGone'
  | 'noStory'
  | 'attachmentUnreadable'
  | 'packageBusy'
  | 'packageSent'
  | 'packageSending'
  | 'packageChanged'
  | 'sentNotSaved'
  | 'historyFull'
  | 'draftExists'
  | 'followUpDone'
  | 'googleNotSignedIn'
  | 'pageUnreadable'
  // A restore waits until nothing else works on the data (spec 0.9.0, section 3.1).
  | 'restoreBusySearch'
  | 'restoreBusyPackage'
  | 'restoreBusyAi'
  | 'restoreBusySend'
  // …and while it runs, nothing else may start (sending, search, package jobs, mailbox changes).
  | 'restoreRunning'
  // Backup files (spec 0.9.0, section 3.1).
  | 'backupTooLarge'
  | 'backupNotZip'
  | 'backupGone'
  // The backup folder chosen in Settings (0.9.0): not an absolute local path / inside the app data / not writable.
  | 'backupFolderInvalid'
  | 'backupFolderInData'
  | 'backupFolderNotWritable';
