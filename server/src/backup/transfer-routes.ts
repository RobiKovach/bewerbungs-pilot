import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type { Profile, SectionId } from '@bp/shared';
import type { DataPaths } from '../data/paths.js';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';
import { emptyProfile } from '../profile/schema.js';
import type { Activity } from '../runtime/activity.js';
import { removeTemp, type Warn } from './cleanup.js';
import { createBackup } from './create.js';
import { encryptFile } from './encrypt.js';
import { MAX_UNPACKED_BYTES, transferFileName } from './format.js';

export interface TransferRouteDeps {
  paths: DataPaths;
  version: string;
  activity: Activity;
  logger: Logger;
  /** Whether this PC already holds the person's work (an import would replace it). */
  hasData: () => boolean;
  /** Largest file the import accepts (tests); nothing larger may be handed out, or it could never be opened. */
  maxUploadBytes?: number;
}

const exportBody = {
  type: 'object', additionalProperties: false,
  properties: { password: { type: 'string', minLength: 8, maxLength: 200 } },
} as const;

/** A leftover name in tmp: an upload, its decrypted copy (also half-written) or an export folder. All may hold personal data. */
const LEFTOVER = /^(upload-.*\.zip(\.partial)?|transfer-.*)$/;

/** After a crash these would stay on the disk, some unencrypted. Nothing else may be running yet: call it at start only. */
export async function removeTransferLeftovers(tmpDir: string, warn?: Warn): Promise<void> {
  let names: string[];
  try {
    names = await fs.promises.readdir(tmpDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    if (code !== 'ENOENT') warn?.('transfer_leftovers_failed', { code });
    return;
  }
  for (const name of names) {
    if (LEFTOVER.test(name)) await removeTemp(path.join(tmpDir, name), 'transfer_leftovers_failed', warn);
  }
}

/** True once the person has typed or uploaded anything; moving through the first steps or choosing a language is not data. */
export function profileHasData(p: Profile): boolean {
  if (p.cv || p.photo || p.documents.length > 0 || p.stories.length > 0 || p.neverMention.length > 0) return true;
  const empty = emptyProfile();
  return (Object.keys(p.sections) as SectionId[]).some((id) => !isDeepStrictEqual(p.sections[id].data, empty.sections[id].data));
}

export async function registerTransferRoutes(app: FastifyInstance, d: TransferRouteDeps): Promise<void> {
  const maxBytes = d.maxUploadBytes ?? MAX_UNPACKED_BYTES;
  const warn: Warn = (event, data) => d.logger.warn(event, data);

  app.get('/api/transfer/status', async () => ({ hasData: d.hasData() }));

  app.post('/api/transfer/export', {
    // Fastify's Ajv drops unknown keys: a misspelled "password" would quietly give a file anyone can open.
    preValidation: async (req) => {
      const b = req.body;
      if (b && typeof b === 'object' && Object.keys(b).some((k) => k !== 'password')) throw new AppError('BAD_REQUEST', 'only { password } is accepted');
    },
    schema: { body: exportBody },
  }, async (req, reply) => {
    d.activity.refuseDuringRestore();
    const { password } = req.body as { password?: string };
    const now = new Date();
    let dir: string | null = null;
    let file: string;
    let sizeBytes: number;
    try {
      await fs.promises.mkdir(d.paths.tmp, { recursive: true });
      dir = await fs.promises.mkdtemp(path.join(d.paths.tmp, `transfer-${now.getTime()}-`));
      // Only the zipping: a restore or an update replacing the data meanwhile would give a mixed copy.
      const end = d.activity.begin('export');
      let backup: Awaited<ReturnType<typeof createBackup>>;
      try {
        backup = await createBackup(d.paths.root, { dir, kind: 'manual', appVersion: d.version, now });
      } finally {
        end();
      }
      file = backup.file;
      if (password) {
        file = path.join(dir, 'encrypted.zip');
        await encryptFile(backup.file, file, password, warn);
        await removeTemp(backup.file, 'transfer_cleanup_failed', warn);
      }
      sizeBytes = (await fs.promises.stat(file)).size;
      if (sizeBytes > maxBytes) throw new AppError('FILE_TOO_LARGE', 'transfer file is larger than the import accepts', 'backupTooLarge');
    } catch (err) {
      if (dir) await removeTemp(dir, 'transfer_cleanup_failed', warn);
      throw err instanceof AppError ? err : new AppError('BACKUP_FAILED', String(err));
    }

    const tempDir = dir;
    const stream = fs.createReadStream(file);
    let removing = false;
    // 'close' comes after a finished download and after an abort alike. Windows will not delete a file that is still open.
    const remove = () => {
      if (removing) return;
      removing = true;
      const go = () => { void removeTemp(tempDir, 'transfer_cleanup_failed', warn); };
      if (stream.closed) { go(); return; }
      stream.once('close', go);
      stream.destroy();
    };
    reply.raw.once('close', remove);
    if (reply.raw.destroyed) remove();
    d.logger.info('transfer_exported', { encrypted: Boolean(password), sizeBytes });
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Length', sizeBytes)
      .header('Content-Disposition', `attachment; filename="${transferFileName(now, Boolean(password))}"`)
      .send(stream);
  });
}
