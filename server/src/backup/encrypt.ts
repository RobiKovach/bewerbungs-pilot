import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../errors.js';
import { removeTemp, type Warn } from './cleanup.js';

/**
 * Password-protected transfer file (spec 2026-11-04 transfer, section 4).
 * Layout: "BPENC" | version u8 | logN u8 | r u8 | p u8 | salt 16 | nonce 12 (37 bytes, also GCM AAD) | ciphertext | tag 16.
 * Key: scrypt(NFKC(password), salt). Cipher: AES-256-GCM.
 */
export const ENCRYPTED_MAGIC = 'BPENC';
const VERSION = 1;
const HEADER_BYTES = 37;
const TAG_BYTES = 16;
const WRITE_PARAMS = { logN: 17, r: 8, p: 1 };
const MAX_PARAMS = { logN: 18, r: 8, p: 2 };

const diskFailed = (err: unknown) => new AppError('BACKUP_FAILED', String(err));
const cannotOpen = (details: string) => new AppError('BACKUP_INVALID', details, 'transferCannotOpen');

function deriveKey(password: string, salt: Buffer, p: { logN: number; r: number; p: number }): Promise<Buffer> {
  const N = 2 ** p.logN;
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, 32, { N, r: p.r, p: p.p, maxmem: 256 * N * p.r }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** True only for a file that starts with the magic; a missing, empty or unreadable file is simply "no". */
export async function isEncryptedFile(file: string): Promise<boolean> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(file, 'r');
    const buf = Buffer.alloc(ENCRYPTED_MAGIC.length);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return bytesRead === buf.length && buf.toString('ascii') === ENCRYPTED_MAGIC;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** `warn` hears when a partial output could not be removed (the partial of a decryption holds personal data). */
export async function encryptFile(input: string, output: string, password: string, warn?: Warn): Promise<void> {
  const partial = `${output}.partial`;
  try {
    const salt = crypto.randomBytes(16);
    const nonce = crypto.randomBytes(12);
    const header = Buffer.concat([
      Buffer.from(ENCRYPTED_MAGIC, 'ascii'),
      Buffer.from([VERSION, WRITE_PARAMS.logN, WRITE_PARAMS.r, WRITE_PARAMS.p]),
      salt,
      nonce,
    ]);
    const key = await deriveKey(password, salt, WRITE_PARAMS);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(header);
    async function* source() {
      yield header;
      for await (const chunk of fs.createReadStream(input)) yield cipher.update(chunk as Buffer);
      yield cipher.final();
      yield cipher.getAuthTag();
    }
    await pipeline(Readable.from(source()), fs.createWriteStream(partial));
    await fs.promises.rename(partial, output);
  } catch (err) {
    await removeTemp(partial, 'transfer_partial_cleanup_failed', warn);
    throw err instanceof AppError ? err : diskFailed(err);
  }
}

export async function decryptFile(input: string, output: string, password: string, warn?: Warn): Promise<void> {
  const partial = `${output}.partial`;
  try {
    let header: Buffer;
    let tag: Buffer;
    let size: number;
    try {
      size = (await fs.promises.stat(input)).size;
      if (size < HEADER_BYTES + TAG_BYTES) throw cannotOpen('file too short');
      const handle = await fs.promises.open(input, 'r');
      try {
        header = Buffer.alloc(HEADER_BYTES);
        tag = Buffer.alloc(TAG_BYTES);
        await handle.read(header, 0, HEADER_BYTES, 0);
        await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
      } finally {
        await handle.close();
      }
    } catch (err) {
      throw err instanceof AppError ? err : diskFailed(err);
    }
    if (header.subarray(0, 5).toString('ascii') !== ENCRYPTED_MAGIC) throw cannotOpen('no magic');
    const version = header[5];
    if (version > VERSION) throw new AppError('BACKUP_NEWER', `transfer file version ${version}`);
    if (version < 1) throw cannotOpen(`version ${version}`);
    const params = { logN: header[6], r: header[7], p: header[8] };
    if (params.logN > MAX_PARAMS.logN || params.r > MAX_PARAMS.r || params.p > MAX_PARAMS.p || params.logN < 1 || params.r < 1 || params.p < 1) {
      throw cannotOpen('scrypt parameters out of range');
    }
    const salt = header.subarray(9, 25);
    const nonce = header.subarray(25, 37);
    let key: Buffer;
    try {
      key = await deriveKey(password, salt, params);
    } catch (err) {
      throw cannotOpen(`key derivation: ${String(err)}`);
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    const bodyEnd = size - TAG_BYTES; // exclusive
    const source = bodyEnd > HEADER_BYTES ? fs.createReadStream(input, { start: HEADER_BYTES, end: bodyEnd - 1 }) : Readable.from([]);
    const out = fs.createWriteStream(partial);
    // pipeline() tears down all sides when one fails, so the side that failed first decides.
    let first: 'input' | 'cipher' | 'output' | null = null;
    source.once('error', () => { first ??= 'input'; });
    decipher.once('error', () => { first ??= 'cipher'; });
    out.once('error', () => { first ??= 'output'; });
    try {
      await pipeline(source, decipher, out);
    } catch (err) {
      throw first === 'cipher' || first === null ? cannotOpen(`authentication: ${String(err)}`) : diskFailed(err);
    }
    await fs.promises.rename(partial, output).catch((err: unknown) => { throw diskFailed(err); });
  } catch (err) {
    await removeTemp(partial, 'transfer_partial_cleanup_failed', warn);
    throw err;
  }
}
