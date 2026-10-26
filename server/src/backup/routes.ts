import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { BackupFolderView, BackupInfo, BackupListView } from '@bp/shared';
import type { ApplicationJob } from '../applications/job.js';
import type { DataPaths } from '../data/paths.js';
import type { SettingsStore } from '../data/settings.js';
import { AppError, type ErrorReason } from '../errors.js';
import type { LlmQueue } from '../llm/queue.js';
import type { Logger } from '../log.js';
import type { GoogleAuth } from '../mail/google-auth.js';
import { revokeToken } from '../mail/revoke.js';
import type { SecretStore } from '../mail/secret.js';
import { mapUploadError } from '../profile/upload.js';
import type { Activity } from '../runtime/activity.js';
import type { SearchJob } from '../vacancies/search-job.js';
import { createBackup } from './create.js';
import { checkChosenFolder } from './folder.js';
import { listBackups } from './extract.js';
import { MAX_UNPACKED_BYTES } from './format.js';
import { restoreBackup } from './restore.js';

export interface BackupRouteDeps {
  paths: DataPaths;
  version: string;
  /** The backup folder (created) for the folder chosen in Settings (null = automatic): backup/folder.ts `backupFolder`. */
  folder: (chosen: string | null) => Promise<BackupFolderView>;
  /** Re-reads every store from disk after a restore. */
  reload: () => void;
  /** Shows the folder in Explorer. */
  openFolder: (dir: string) => void;
  searchJob: SearchJob;
  applicationJob: ApplicationJob;
  queue: LlmQueue;
  activity: Activity;
  settings: SettingsStore;
  secrets: SecretStore;
  googleAuth: GoogleAuth;
  logger: Logger;
  revokeTimeoutMs?: number;
  /** Largest accepted upload (tests); 1 GB like the unpacked limit. */
  maxUploadBytes?: number;
}

/**
 * A file name from the list — any name the list shows ("… - Kopie.zip", "…(1).zip", Cyrillic): only folder separators,
 * Windows-reserved and control characters are refused, and the handler still resolves it inside the backup folder only.
 */
const restoreBody = {
  type: 'object', additionalProperties: false, required: ['name'],
  properties: { name: { type: 'string', maxLength: 255, pattern: '^[^\\\\/:*?"<>|\\u0000-\\u001f]+\\.[zZ][iI][pP]$' } },
} as const;

const folderBody = {
  type: 'object', additionalProperties: false, required: ['folder'],
  properties: { folder: { type: ['string', 'null'], maxLength: 400 } },
} as const;

export async function registerBackupRoutes(app: FastifyInstance, d: BackupRouteDeps): Promise<void> {
  const where = () => d.folder(d.settings.get().backups.folder);
  const listView = async (): Promise<BackupListView> => {
    const folder = await where();
    const backups: BackupInfo[] = await listBackups(folder.dir, {
      appVersion: d.version,
      onSkip: (file, err) => d.logger.warn('backup_skipped', { name: path.basename(file), code: err instanceof AppError ? err.code : 'UNKNOWN' }),
    });
    return { ...folder, backups };
  };
  const busy = (): ErrorReason | null => {
    if (d.searchJob.state().state === 'running') return 'restoreBusySearch';
    if (d.applicationJob.state().state === 'running') return 'restoreBusyPackage';
    const q = d.queue.status();
    if (q.running || q.queued > 0) return 'restoreBusyAi';
    if (d.activity.active().includes('send')) return 'restoreBusySend';
    return null;
  };

  const restore = async (file: string) => {
    // One restore at a time; the UI disables the buttons, this keeps two quick requests apart.
    d.activity.refuseDuringRestore();
    const end = d.activity.begin('restore');
    try {
      // The backup folder belongs to this PC, not to the data: a backup from elsewhere (or from before the folder was
      // chosen) must not move where the next backups go — nor where the installer puts its own.
      const chosenFolder = d.settings.get().backups.folder;
      const result = await restoreBackup(file, {
        paths: d.paths, appVersion: d.version, backupDir: (await where()).dir, busy, reload: d.reload,
        warn: (event, data) => d.logger.warn(event, data),
        mail: {
          before: d.settings.get().mail,
          loadKey: () => d.secrets.load(),
          removeKey: () => d.secrets.removeSync(),
          revoke: (key) => revokeToken(d, key, 'restore'),
        },
      });
      if (d.settings.get().backups.folder !== chosenFolder) d.settings.setBackupFolder(chosenFolder);
      d.logger.info('backup_restored', { appVersion: result.restored.appVersion, kind: result.restored.kind });
      return result;
    } finally {
      end();
    }
  };

  app.get('/api/backups', async () => listView());

  /** Settings → Backups → "Change folder" / "Back to automatic"; answers with the list from the new folder. */
  app.put('/api/backups/folder', { schema: { body: folderBody } }, async (req) => {
    const { folder } = req.body as { folder: string | null };
    const next = folder === null || folder.trim() === '' ? null : await checkChosenFolder(folder, d.paths.root);
    d.settings.setBackupFolder(next);
    d.logger.info('backup_folder_set', { automatic: next === null });
    return listView();
  });

  app.post('/api/backups', async () => {
    const info = await createBackup(d.paths.root, { dir: (await where()).dir, kind: 'manual', appVersion: d.version });
    d.logger.info('backup_created', { kind: info.kind, sizeBytes: info.sizeBytes });
    return info;
  });

  app.post('/api/backups/restore', { schema: { body: restoreBody } }, async (req) => {
    const { name } = req.body as { name: string };
    const { dir } = await where();
    const file = path.resolve(dir, name);
    if (path.dirname(file) !== path.resolve(dir)) throw new AppError('BAD_REQUEST', 'backup name outside the backup folder');
    if (!fs.existsSync(file)) throw new AppError('NOT_FOUND', 'no such backup', 'backupGone');
    return restore(file);
  });

  const maxUpload = d.maxUploadBytes ?? MAX_UNPACKED_BYTES;
  /** The generic size text speaks about CVs and photos; a backup gets its own sentence. */
  const tooLarge = (err: unknown): unknown =>
    err instanceof AppError && err.code === 'FILE_TOO_LARGE' ? new AppError('FILE_TOO_LARGE', 'backup is larger than 1 GB', 'backupTooLarge') : err;

  app.post('/api/backups/restore-upload', async (req) => {
    if (!req.isMultipart()) throw new AppError('BAD_REQUEST', 'expected multipart/form-data');
    let part;
    try {
      part = await req.file({ limits: { fileSize: maxUpload, files: 1 } });
    } catch (err) {
      throw tooLarge(mapUploadError(err));
    }
    if (!part) throw new AppError('BAD_REQUEST', 'the request contains no file');
    if (!/\.zip$/i.test(part.filename)) {
      part.file.resume();
      throw new AppError('BAD_REQUEST', 'only a .zip backup can be restored', 'backupNotZip');
    }
    await fs.promises.mkdir(d.paths.tmp, { recursive: true });
    const target = path.join(d.paths.tmp, `upload-${Date.now()}.zip`);
    try {
      try {
        await pipeline(part.file, fs.createWriteStream(target));
      } catch (err) {
        throw tooLarge(mapUploadError(err));
      }
      if (part.file.truncated) throw new AppError('FILE_TOO_LARGE', 'backup is larger than 1 GB', 'backupTooLarge');
      return await restore(target);
    } finally {
      await fs.promises.rm(target, { force: true }).catch(() => {});
    }
  });

  app.post('/api/backups/open-folder', async () => {
    d.openFolder((await where()).dir);
    return { ok: true };
  });
}
