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
import { removeTemp, type Warn } from './cleanup.js';
import { createBackup } from './create.js';
import { decryptFile, isEncryptedFile } from './encrypt.js';
import { checkChosenFolder, createFolder } from './folder.js';
import { listBackups } from './extract.js';
import { MAX_UNPACKED_BYTES } from './format.js';
import { restoreBackup } from './restore.js';

export interface BackupRouteDeps {
  paths: DataPaths;
  version: string;
  /** Where backups go for the folder chosen in Settings (null = automatic), nothing created: backup/folder.ts `resolveBackupFolder`. */
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

/** Longest password an export accepts: a longer one cannot have made the file. */
const MAX_PASSWORD_CHARS = 200;

/** The multipart "password" field. Anything but one plain text value (a file, a repeated field, JSON that is no string, empty) is no password. */
function passwordField(field: unknown): string | null {
  const f = field as { type?: unknown; value?: unknown } | undefined;
  return f?.type === 'field' && typeof f.value === 'string' && f.value !== '' ? f.value : null;
}

export async function registerBackupRoutes(app: FastifyInstance, d: BackupRouteDeps): Promise<void> {
  const where = () => d.folder(d.settings.get().backups.folder);
  /** For writing: the folder, created now; a missing USB stick or drive → BACKUP_FAILED with its own sentence. */
  const writeDir = async () => createFolder((await where()).dir);
  // Reading never creates the folder and never fails because it is gone: the card must stay usable to choose another.
  const listView = async (): Promise<BackupListView> => {
    const folder = await where();
    if (!folder.available) return { ...folder, backups: [] };
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
    if (q.running || q.queued > 0 || d.activity.active().includes('interview')) return 'restoreBusyAi';
    if (d.activity.active().includes('send')) return 'restoreBusySend';
    if (d.activity.active().includes('export')) return 'restoreBusyExport';
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
      // Likewise the anonymous install id: one PC stays one install, whichever PC the backup came from.
      const localInstallId = d.settings.get().usage.installId;
      const result = await restoreBackup(file, {
        paths: d.paths, appVersion: d.version, backupDir: await writeDir(), busy, reload: d.reload,
        warn: (event, data) => d.logger.warn(event, data),
        mail: {
          before: d.settings.get().mail,
          loadKey: () => d.secrets.load(),
          removeKey: () => d.secrets.removeSync(),
          revoke: (key) => revokeToken(d, key, 'restore'),
        },
      });
      if (d.settings.get().backups.folder !== chosenFolder) {
        // The restore itself succeeded: a failed write here must not turn it into an error (the next one tries again
        // via Settings; the installer then follows the restored file).
        try { d.settings.setBackupFolder(chosenFolder); } catch (err) {
          d.logger.warn('backup_folder_keep_failed', { code: err instanceof AppError ? err.code : 'UNKNOWN' });
        }
      }
      if (localInstallId && d.settings.get().usage.installId !== localInstallId) {
        try { d.settings.setInstallId(localInstallId); } catch (err) {
          d.logger.warn('install_id_keep_failed', { code: err instanceof AppError ? err.code : 'UNKNOWN' });
        }
      }
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
    // A restore re-applies the folder it started with; changing it meanwhile would be lost.
    d.activity.refuseDuringRestore();
    const next = folder === null || folder.trim() === '' ? null : await checkChosenFolder(folder, d.paths.root);
    d.settings.setBackupFolder(next);
    d.logger.info('backup_folder_set', { automatic: next === null });
    return listView();
  });

  app.post('/api/backups', async () => {
    // Refused while a restore is running; checked again after the awaits, since one may have started meanwhile.
    d.activity.refuseDuringRestore();
    const dir = await writeDir();
    d.activity.refuseDuringRestore();
    const end = d.activity.begin('export');
    let info: BackupInfo;
    try {
      info = await createBackup(d.paths.root, { dir, kind: 'manual', appVersion: d.version });
    } finally {
      end();
    }
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
      // The global limits (profile/routes.ts) allow no fields; this one route takes the password, before the file.
      part = await req.file({ limits: { fileSize: maxUpload, files: 1, fields: 1, parts: 2 } });
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
    const plain = target.replace(/\.zip$/, '-plain.zip');
    const warn: Warn = (event, data) => d.logger.warn(event, data);
    const password = passwordField(part.fields.password);
    try {
      try {
        await pipeline(part.file, fs.createWriteStream(target));
      } catch (err) {
        throw tooLarge(mapUploadError(err));
      }
      if (part.file.truncated) throw new AppError('FILE_TOO_LARGE', 'backup is larger than 1 GB', 'backupTooLarge');
      if (!(await isEncryptedFile(target))) return await restore(target);
      // Decrypted first: a wrong password must not even make the before-restore backup.
      if (password === null) throw new AppError('BACKUP_INVALID', 'encrypted file without a password', 'transferPasswordNeeded');
      if ([...password].length > MAX_PASSWORD_CHARS) throw new AppError('BACKUP_INVALID', 'password too long', 'transferCannotOpen');
      await decryptFile(target, plain, password, warn);
      return await restore(plain);
    } finally {
      await removeTemp(target, 'transfer_upload_cleanup_failed', warn);
      await removeTemp(plain, 'transfer_upload_cleanup_failed', warn);
    }
  });

  app.post('/api/backups/open-folder', async () => {
    d.openFolder(await writeDir());
    return { ok: true };
  });
}
