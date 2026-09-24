import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest } from 'fastify';
import type { StoredFile } from '@bp/shared';
import { AppError } from '../errors.js';
import { FILE_RULES, type ProfileFiles, type UploadKind } from './files.js';

/** Multipart plugin errors → our codes. Anything else passes through unchanged. */
export function mapUploadError(err: unknown): unknown {
  if (err instanceof AppError) return err;
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') return new AppError('FILE_TOO_LARGE', 'multipart file size limit');
  if (typeof code === 'string' && code.startsWith('FST_')) return new AppError('BAD_REQUEST', `${code}: ${(err as Error).message}`);
  return err;
}

/** Streams the request's single file to disk (never whole into memory), then checks its real type. */
export async function receiveUpload(req: FastifyRequest, files: ProfileFiles, kind: UploadKind): Promise<StoredFile> {
  if (!req.isMultipart()) throw new AppError('BAD_REQUEST', 'expected multipart/form-data');
  const { maxBytes } = FILE_RULES[kind];
  let part;
  try {
    part = await req.file({ limits: { fileSize: maxBytes, files: 1 } });
  } catch (err) {
    throw mapUploadError(err);
  }
  if (!part) throw new AppError('BAD_REQUEST', 'the request contains no file');
  const target = files.newUploadPath();
  try {
    await pipeline(part.file, fs.createWriteStream(target));
    if (part.file.truncated) throw new AppError('FILE_TOO_LARGE', `${kind} is larger than ${maxBytes} bytes`);
    return files.adopt(target, kind, part.filename);
  } catch (err) {
    fs.rmSync(target, { force: true });
    throw mapUploadError(err);
  }
}
