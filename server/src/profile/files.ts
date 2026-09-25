import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FileExt, StoredFile } from '@bp/shared';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';

export type UploadKind = 'cv' | 'photo' | 'document';

const MB = 1024 * 1024;
export const FILE_RULES: Record<UploadKind, { maxBytes: number; exts: readonly FileExt[] }> = {
  cv: { maxBytes: 10 * MB, exts: ['.pdf', '.docx'] },
  photo: { maxBytes: 5 * MB, exts: ['.jpg', '.png'] },
  document: { maxBytes: 10 * MB, exts: ['.pdf'] },
};
export const MAX_DOCUMENTS = 20;
export const FILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CONTENT_TYPES: Record<FileExt, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const HEAD_BYTES = 1024;

/** The real type from the first bytes. The name only decides between DOCX and other ZIP files (XLSX, …). */
export function detectExt(head: Buffer, originalName: string): FileExt | null {
  // Exact leading magic bytes first: a JPEG whose metadata happens to contain "%PDF-" is still a JPEG.
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return '.jpg';
  if (head.subarray(0, 8).equals(PNG_MAGIC)) return '.png';
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return '.pdf';
  if (head.subarray(0, 4).equals(ZIP_MAGIC)) return /\.docx$/i.test(originalName) ? '.docx' : null;
  // Fallback: some PDF writers put a few bytes before the header; readers accept it within the first 1 KB.
  if (head.subarray(0, HEAD_BYTES).includes('%PDF-')) return '.pdf';
  return null;
}

/** Only a label shown to the person — never used as a path. */
export function cleanOriginalName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const visible = [...base].filter((ch) => ch.charCodeAt(0) >= 32).join('');
  const cleaned = visible.replace(/[<>:"|?*]/g, '_').trim().slice(0, 200);
  return cleaned || 'file';
}

function readHead(file: string): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

export class ProfileFiles {
  constructor(private readonly dir: string) {}

  pathOf(file: Pick<StoredFile, 'id' | 'ext'>): string {
    return path.join(this.dir, `${file.id}${file.ext}`);
  }

  /** Where an upload is streamed before its type is known. */
  newUploadPath(): string {
    return path.join(this.dir, `.upload-${crypto.randomBytes(8).toString('hex')}`);
  }

  /** Checks a finished upload's real type and gives it its final generated name; deletes it when not allowed. */
  adopt(uploadPath: string, kind: UploadKind, originalName: string): StoredFile {
    const name = cleanOriginalName(originalName);
    const ext = detectExt(readHead(uploadPath), name);
    if (!ext || !FILE_RULES[kind].exts.includes(ext)) {
      fs.rmSync(uploadPath, { force: true });
      throw new AppError('FILE_TYPE_NOT_ALLOWED', `${kind}: detected ${ext ?? 'unknown type'}`, 'fileTypeDetected', { kind, detected: ext ?? 'unknown' });
    }
    const stored: StoredFile = {
      id: crypto.randomUUID(), ext, originalName: name, size: fs.statSync(uploadPath).size, uploadedAt: new Date().toISOString(),
    };
    fs.renameSync(uploadPath, this.pathOf(stored));
    return stored;
  }

  remove(file: Pick<StoredFile, 'id' | 'ext'>): void {
    fs.rmSync(this.pathOf(file), { force: true });
  }

  exists(file: Pick<StoredFile, 'id' | 'ext'>): boolean {
    return fs.existsSync(this.pathOf(file));
  }
}

/**
 * Deletes a file that is no longer referenced by the profile (the old CV/photo right after a
 * successful replace) without ever throwing. The new file was already committed to the profile by
 * the time this runs, so a failure here (e.g. a Windows lock) must never bubble up and must never
 * cause the new, now-referenced file to be deleted by a caller's catch block — it is only logged.
 */
export function removeQuietly(files: ProfileFiles, file: Pick<StoredFile, 'id' | 'ext'>, logger: Logger): void {
  try {
    files.remove(file);
  } catch (err) {
    logger.warn('profile_old_file_not_removed', { id: file.id, message: err instanceof Error ? err.message : String(err) });
  }
}
