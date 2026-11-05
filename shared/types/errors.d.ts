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
  /** A feedback message could not reach our cloud service (reason: offline | limit | server). */
  | 'FEEDBACK_FAILED'
  /** The demo copy of the app (spec 0.10.0) did not start. */
  | 'DEMO_FAILED'
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
  // A pasted PDF link whose PDF has no text (a scan) (0.9.1).
  | 'pdfNoText'
  // The 'find contact' window waited 5 minutes without the employer's contact appearing (0.9.1 B).
  | 'contactTimeout'
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
  // Password-protected transfer file (spec 2026-11-04 transfer, section 4).
  | 'transferPasswordNeeded'
  | 'transferCannotOpen'
  // The backup folder chosen in Settings (0.9.0): not an absolute local path / inside the app data / not writable.
  | 'backupFolderInvalid'
  | 'backupFolderInData'
  | 'backupFolderNotWritable'
  | 'backupFolderUnavailable'
  // Feedback to the developer (0.11.0): what went wrong when it could not be sent.
  | 'offline'
  | 'limit'
  | 'server'
  // One-click update (0.11.0): the download failed / differs from the published checksum / is not a valid release.
  | 'updateDownload'
  | 'updateChecksum'
  | 'updateInvalid'
  // …the installer could not be started.
  | 'updateStart'
  // …and starting one: already running / nothing to install / other work is still running (params.what).
  | 'updateRunning'
  | 'noUpdate'
  | 'busy'
  // Interview preparation (0.12.0): not yet / no more / already there / one request at a time / questions open / file unreadable.
  | 'prepNotAvailable'
  | 'prepReadOnly'
  | 'prepExists'
  | 'prepBusy'
  | 'prepNotFinished'
  | 'prepUnreadable';
