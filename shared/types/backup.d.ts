/** Who made a backup: the "Save backup" button, the installer before an update, or a restore (the data it replaced). */
export type BackupKind = 'manual' | 'installer' | 'before-restore';

/** `backup.json` at the root of every backup zip (spec 0.9.0, section 3.1). */
export interface BackupMeta {
  format: 1;
  app: 'bewerbungs-pilot';
  appVersion: string;
  createdAt: string;
  kind: BackupKind;
}

export interface BackupInfo extends BackupMeta {
  /** Full path of the zip on this PC. */
  file: string;
  name: string;
  sizeBytes: number;
  /** Made by a newer app version than the one running: listed, but restoring it is refused (BACKUP_NEWER). */
  newer: boolean;
}
