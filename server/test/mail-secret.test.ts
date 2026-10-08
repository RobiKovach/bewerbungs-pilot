import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DpapiSecretStore, MemorySecretStore } from '../src/mail/secret.js';

describe('secret stores', () => {
  it('MemorySecretStore round-trips and removes', async () => {
    const s = new MemorySecretStore();
    expect(await s.load()).toBeNull();
    await s.save('abcd efgh');
    expect(await s.load()).toBe('abcd efgh');
    await s.remove();
    expect(await s.load()).toBeNull();
  });

  it.runIf(process.platform === 'win32')('DPAPI round-trip; the file does not contain the secret; a broken file loads as null', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp secret Дані-')), 'mail-secret.bin');
    const s = new DpapiSecretStore(file);
    await s.save('abcd Pässwort-Ünï-Ж');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('abcd');
    expect(await s.load()).toBe('abcd Pässwort-Ünï-Ж');
    fs.writeFileSync(file, 'bm90IGRwYXBp');
    expect(await s.load()).toBeNull();
    await s.remove();
    expect(fs.existsSync(file)).toBe(false);
  }, 30_000);
});
