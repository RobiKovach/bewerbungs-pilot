import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkLocales, checkInstallerMessages } from './i18n-check.mjs';

const en = { a: { b: 'Hello {{name}}' }, c: 'Bye' };

describe('checkLocales', () => {
  it('accepts complete locales', () => {
    expect(checkLocales({ locales: { en, uk: { a: { b: 'Привіт {{name}}' }, c: 'Бувай' } } })).toEqual([]);
  });
  it('reports missing, extra and empty keys', () => {
    const problems = checkLocales({ locales: { en, de: { a: { b: '' }, x: 'extra' } } });
    expect(problems).toEqual(expect.arrayContaining([
      'de: missing key "c"',
      'de: extra key "x"',
      'de: empty value "a.b"',
    ]));
  });
  it('reports placeholder mismatches', () => {
    expect(checkLocales({ locales: { en, pl: { a: { b: 'Cześć {{imie}}' }, c: 'Pa' } } }))
      .toContain('pl: placeholders differ in "a.b" (expected {{name}})');
  });
  it('reports keys used in code but missing in en', () => {
    expect(checkLocales({ locales: { en }, usedKeys: ['a.b', 'nope.key'] })).toEqual(['code uses unknown key "nope.key"']);
  });
});

describe('checkInstallerMessages', () => {
  it('handles missing installer/messages.json gracefully', () => {
    const tmpFile = path.join(os.tmpdir(), 'nonexistent-messages.json');
    expect(checkInstallerMessages(tmpFile)).toEqual([]);
  });
  it('reports missing language "en" without throwing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-test-'));
    const tmpFile = path.join(tmpDir, 'messages.json');
    fs.writeFileSync(tmpFile, JSON.stringify({ uk: { a: 'value' } }), 'utf8');
    try {
      const problems = checkInstallerMessages(tmpFile);
      expect(problems).toEqual(expect.arrayContaining([
        'installer: missing language "en"',
      ]));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
