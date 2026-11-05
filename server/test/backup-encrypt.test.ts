import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/errors.js';

vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  const scrypt = vi.fn(real.scrypt);
  return { ...real, default: { ...real, scrypt }, scrypt };
});

const { ENCRYPTED_MAGIC, isEncryptedFile, encryptFile, decryptFile } = await import('../src/backup/encrypt.js');

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-enc-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); vi.clearAllMocks(); });

const p = (n: string) => path.join(dir, n);
async function seal(data: Buffer, password = 'secret'): Promise<string> {
  fs.writeFileSync(p('plain'), data);
  await encryptFile(p('plain'), p('enc'), password);
  return p('enc');
}
async function expectCannotOpen(promise: Promise<void>) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe('BACKUP_INVALID');
  expect((err as AppError).reason).toBe('transferCannotOpen');
  expect(fs.existsSync(p('out'))).toBe(false);
  expect(fs.existsSync(p('out.partial'))).toBe(false);
}

describe('backup encryption', () => {
  it('round trip restores identical bytes', async () => {
    for (const data of [Buffer.from('hello'), crypto.randomBytes(5 * 1024 * 1024)]) {
      const enc = await seal(data);
      await decryptFile(enc, p('out'), 'secret');
      expect(fs.readFileSync(p('out')).equals(data)).toBe(true);
      expect(crypto.scrypt).toHaveBeenCalled(); // the spy really sees the calls
      fs.rmSync(p('out'));
    }
  });

  it('the output does not contain the plaintext and starts with BPENC', async () => {
    const enc = await seal(Buffer.from('very-recognisable-plaintext-marker'));
    const raw = fs.readFileSync(enc);
    expect(raw.subarray(0, 5).toString('ascii')).toBe(ENCRYPTED_MAGIC);
    expect(raw.includes('very-recognisable')).toBe(false);
    expect(fs.existsSync(p('enc.partial'))).toBe(false);
  });

  it('two encryptions of one file differ', async () => {
    const data = Buffer.from('same');
    const a = fs.readFileSync(await seal(data));
    fs.rmSync(p('enc'));
    const b = fs.readFileSync(await seal(data));
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(9, 25).equals(b.subarray(9, 25))).toBe(false); // salt
    expect(a.subarray(25, 37).equals(b.subarray(25, 37))).toBe(false); // nonce
  });

  it('writes the agreed format: scrypt 17/8/1, header 37 + tag 16 around the body', async () => {
    const plain = Buffer.from('format pin');
    const raw = fs.readFileSync(await seal(plain));
    expect([raw[5], raw[6], raw[7], raw[8]]).toEqual([1, 17, 8, 1]);
    expect(raw.length).toBe(plain.length + 53);
  });

  it('Cyrillic password in NFC opens a file made with its NFD form', async () => {
    const enc = await seal(Buffer.from('data'), 'пароль-й'.normalize('NFD'));
    await decryptFile(enc, p('out'), 'пароль-й'.normalize('NFC'));
    expect(fs.readFileSync(p('out')).toString()).toBe('data');
  });

  it('wrong password', async () => {
    const enc = await seal(Buffer.from('data'));
    await expectCannotOpen(decryptFile(enc, p('out'), 'other'));
  });

  it('one flipped byte in the body', async () => {
    const enc = await seal(Buffer.from('some data to protect'));
    const raw = fs.readFileSync(enc);
    raw[40] ^= 1;
    fs.writeFileSync(enc, raw);
    await expectCannotOpen(decryptFile(enc, p('out'), 'secret'));
  });

  it('one flipped byte in the header', async () => {
    const enc = await seal(Buffer.from('some data to protect'));
    const raw = fs.readFileSync(enc);
    raw[20] ^= 1; // salt
    fs.writeFileSync(enc, raw);
    await expectCannotOpen(decryptFile(enc, p('out'), 'secret'));
  });

  it('truncated by 1 byte', async () => {
    const enc = await seal(Buffer.from('some data to protect'));
    const raw = fs.readFileSync(enc);
    fs.writeFileSync(enc, raw.subarray(0, raw.length - 1));
    await expectCannotOpen(decryptFile(enc, p('out'), 'secret'));
  });

  it('shorter than header + tag', async () => {
    const enc = await seal(Buffer.from('x'));
    const raw = fs.readFileSync(enc);
    fs.writeFileSync(enc, raw.subarray(0, 40));
    await expectCannotOpen(decryptFile(enc, p('out'), 'secret'));
  });

  it('version 2 in the header', async () => {
    const enc = await seal(Buffer.from('data'));
    const raw = fs.readFileSync(enc);
    raw[5] = 2;
    fs.writeFileSync(enc, raw);
    const err = await decryptFile(enc, p('out'), 'secret').then(() => null, (e: unknown) => e);
    expect((err as AppError).code).toBe('BACKUP_NEWER');
    expect(fs.existsSync(p('out'))).toBe(false);
  });

  it('logN 30 in the header', async () => {
    const enc = await seal(Buffer.from('data'));
    const raw = fs.readFileSync(enc);
    raw[6] = 30;
    fs.writeFileSync(enc, raw);
    vi.mocked(crypto.scrypt).mockClear();
    await expectCannotOpen(decryptFile(enc, p('out'), 'secret'));
    expect(crypto.scrypt).not.toHaveBeenCalled();
  });

  it('flipped scrypt p (still inside the limits)', async () => {
    const enc = await seal(Buffer.from('some data to protect'));
    const raw = fs.readFileSync(enc);
    raw[8] = 2;
    fs.writeFileSync(enc, raw);
    await expectCannotOpen(decryptFile(enc, p('out'), 'secret'));
  });

  // Every header byte is checked first (magic, version), enters the key (logN, r, p, salt) or enters GCM (nonce), so no
  // file edit reaches the AAD alone. Holding the derived key constant does: the only thing left to differ is the AAD.
  it('the header is authenticated: flipped p fails with the same key', async () => {
    const sameKey = (...args: unknown[]) => (args[4] as (e: Error | null, k: Buffer) => void)(null, Buffer.alloc(32, 7));
    const scrypt = vi.mocked(crypto.scrypt);
    scrypt.mockImplementationOnce(sameKey as never).mockImplementationOnce(sameKey as never).mockImplementationOnce(sameKey as never);
    const enc = await seal(Buffer.from('some data to protect'));
    await decryptFile(enc, p('control'), 'secret'); // the constant key alone does not break anything
    expect(fs.readFileSync(p('control')).toString()).toBe('some data to protect');
    const raw = fs.readFileSync(enc);
    raw[8] = 2;
    fs.writeFileSync(enc, raw);
    await expectCannotOpen(decryptFile(enc, p('out'), 'secret'));
    expect(scrypt).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['logN 0', 6, 0],
    ['r over the limit', 7, 9],
    ['r 0', 7, 0],
    ['p over the limit', 8, 3],
    ['p 0', 8, 0],
  ])('%s in the header: refused before any key derivation', async (_name, offset, value) => {
    const enc = await seal(Buffer.from('data'));
    const raw = fs.readFileSync(enc);
    raw[offset] = value;
    fs.writeFileSync(enc, raw);
    vi.mocked(crypto.scrypt).mockClear();
    await expectCannotOpen(decryptFile(enc, p('out'), 'secret'));
    expect(crypto.scrypt).not.toHaveBeenCalled();
  });

  it('a disk error is BACKUP_FAILED, not "cannot open"', async () => {
    const enc = await seal(Buffer.from('data'));
    const missing = path.join(dir, 'no such folder', 'out');
    const dec = await decryptFile(enc, missing, 'secret').then(() => null, (e: unknown) => e);
    expect((dec as AppError).code).toBe('BACKUP_FAILED');
    expect((dec as AppError).reason).toBeUndefined();
    const made = await encryptFile(p('plain'), missing, 'secret').then(() => null, (e: unknown) => e);
    expect((made as AppError).code).toBe('BACKUP_FAILED');
  });

  it('removes the partial with retries, and says so when it cannot: code only', async () => {
    const enc = await seal(Buffer.from('data'));
    const raw = fs.readFileSync(enc);
    raw[40] ^= 1;
    fs.writeFileSync(enc, raw);
    const rm = vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(Object.assign(new Error('locked C:/secret'), { code: 'EBUSY' }));
    const warn = vi.fn();
    try {
      const err = await decryptFile(enc, p('out'), 'secret', warn).then(() => null, (e: unknown) => e);
      expect((err as AppError).reason).toBe('transferCannotOpen'); // the cleanup failure does not replace the real error
      expect(rm).toHaveBeenCalledWith(p('out.partial'), expect.objectContaining({ force: true, maxRetries: 3, retryDelay: 100 }));
      expect(warn).toHaveBeenCalledWith('transfer_partial_cleanup_failed', { code: 'EBUSY' });
    } finally {
      rm.mockRestore();
    }
  });

  it('isEncryptedFile', async () => {
    const enc = await seal(Buffer.from('data'));
    expect(await isEncryptedFile(enc)).toBe(true);
    fs.writeFileSync(p('a.zip'), Buffer.from('PK\x03\x04rest'));
    expect(await isEncryptedFile(p('a.zip'))).toBe(false);
    fs.writeFileSync(p('empty'), '');
    expect(await isEncryptedFile(p('empty'))).toBe(false);
    expect(await isEncryptedFile(p('missing'))).toBe(false);
  });
});
