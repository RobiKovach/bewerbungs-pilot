import fs from 'node:fs';
import type { BackupFolderView } from '@bp/shared';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';
import type { Activity } from '../runtime/activity.js';
import { createBackup } from './create.js';
import { listBackups } from './extract.js';
import { createFolder } from './folder.js';

const FIRST_CHECK_MS = 3 * 60_000;
const CHECK_EVERY_MS = 6 * 3600_000;
export const AUTO_EVERY_MS = 7 * 24 * 3600_000;
export const AUTO_KEEP = 3;

export interface AutoBackupDeps {
  dataRoot: string;
  version: string;
  folder: () => Promise<BackupFolderView>;
  /** False: nothing to save yet, or the data has a problem the person has not seen — then no copy may push out a good one. */
  ready: () => boolean;
  activity: Activity;
  logger: Logger;
  now?: () => Date;
}

/**
 * A backup a week without anyone asking (0.13.4), into the same folder as the others, keeping the three newest of its
 * own kind. Any backup younger than a week counts. It never disturbs: a missing USB stick, a running restore or update
 * just means trying again a few hours later.
 */
export class AutoBackup {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(private readonly d: AutoBackupDeps) {}

  start(): void {
    this.stopped = false;
    this.plan(FIRST_CHECK_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private plan(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run().finally(() => this.plan(CHECK_EVERY_MS)), ms);
    this.timer.unref();
  }

  /** True when a backup was made. */
  async run(): Promise<boolean> {
    const { activity, logger } = this.d;
    try {
      if (!this.d.ready()) return false;
      const folder = await this.d.folder();
      if (!folder.available) return false;
      const now = this.d.now?.() ?? new Date();
      const list = () => listBackups(folder.dir, { appVersion: this.d.version });
      // A copy "from the future" (the clock was wrong) must not stop the weekly ones.
      const recent = (await list()).some((b) => {
        const age = now.getTime() - Date.parse(b.createdAt);
        return age >= 0 && age < AUTO_EVERY_MS;
      });
      if (recent) return false;
      const dir = await createFolder(folder.dir);
      activity.refuseDuringRestore();
      if (!this.d.ready()) return false;
      const end = activity.begin('export'); // a restore or an update waits for it
      try {
        const info = await createBackup(this.d.dataRoot, { dir, kind: 'auto', appVersion: this.d.version, now });
        logger.info('backup_created', { kind: info.kind, sizeBytes: info.sizeBytes });
        const older = (await list()).filter((b) => b.kind === 'auto' && b.name !== info.name);
        for (const b of older.slice(AUTO_KEEP - 1)) await fs.promises.rm(b.file, { force: true });
      } finally {
        end();
      }
      return true;
    } catch (err) {
      logger.warn('auto_backup_failed', { code: err instanceof AppError ? err.code : 'UNKNOWN' });
      return false;
    }
  }
}
