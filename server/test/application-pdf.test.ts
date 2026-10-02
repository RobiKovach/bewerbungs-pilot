import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, it, expect, vi } from 'vitest';
import { bundlePdfs, countPages, findBrowser, removeProfileDir, sweepStaleProfiles } from '../src/applications/pdf.js';
import { makePdf } from './helpers/applications.js';

describe('findBrowser', () => {
  const env = { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\LAD' };
  it('prefers Edge, then Chrome, in the standard folders', () => {
    const edge86 = path.win32.join('C:\\PF86', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    const chrome = path.win32.join('C:\\PF', 'Google', 'Chrome', 'Application', 'chrome.exe');
    expect(findBrowser(env, (p) => p === edge86 || p === chrome)).toBe(edge86);
    expect(findBrowser(env, (p) => p === chrome)).toBe(chrome);
    const userChrome = path.win32.join('C:\\LAD', 'Google', 'Chrome', 'Application', 'chrome.exe');
    expect(findBrowser(env, (p) => p === userChrome)).toBe(userChrome);
  });
  it('BP_BROWSER wins when it exists; nothing found → null', () => {
    expect(findBrowser({ ...env, BP_BROWSER: 'D:\\x\\browser.exe' }, (p) => p === 'D:\\x\\browser.exe')).toBe('D:\\x\\browser.exe');
    expect(findBrowser(env, () => false)).toBeNull();
  });
});

describe('countPages and bundlePdfs', () => {
  it('counts pages', async () => {
    expect(await countPages(await makePdf(1))).toBe(1);
    expect(await countPages(await makePdf(3))).toBe(3);
  });
  it('bundles parts in the given order', async () => {
    const out = await bundlePdfs([{ name: 'letter', data: await makePdf(1) }, { name: 'cv', data: await makePdf(2) }, { name: 'Zeugnis', data: await makePdf(1) }]);
    expect(await countPages(out)).toBe(4);
  });
  it('an unreadable part stops the bundle and names that part', async () => {
    await expect(bundlePdfs([{ name: 'letter', data: await makePdf(1) }, { name: 'Zeugnis 2020', data: Buffer.from('not a pdf') }]))
      .rejects.toMatchObject({ code: 'CONFLICT', reason: 'attachmentUnreadable', params: { name: 'Zeugnis 2020' } });
  });
});

describe('temporary profile cleanup', () => {
  it('sweeps only old pdf-* folders in the tmp root and ignores a missing root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-sweep-'));
    try {
      const old = path.join(root, 'pdf-old');
      const fresh = path.join(root, 'pdf-fresh');
      const other = path.join(root, 'other-old');
      for (const d of [old, fresh, other]) fs.mkdirSync(d);
      const now = Date.now();
      const longAgo = new Date(now - 2 * 60 * 60 * 1000);
      fs.utimesSync(old, longAgo, longAgo);
      fs.utimesSync(other, longAgo, longAgo);
      sweepStaleProfiles(root, now);
      expect(fs.existsSync(old)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true);
      expect(fs.existsSync(other)).toBe(true);
      expect(() => sweepStaleProfiles(path.join(root, 'missing'))).not.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it('a failing delete only warns with the error code (no path) and never throws', () => {
    const rm = vi.spyOn(fs, 'rmSync').mockImplementation(() => { throw Object.assign(new Error('EBUSY: D:/secret/path'), { code: 'EBUSY' }); });
    const warn = vi.fn();
    try {
      expect(() => removeProfileDir('D:/secret/path', warn)).not.toThrow();
    } finally {
      rm.mockRestore();
    }
    expect(warn).toHaveBeenCalledWith('pdf.profileCleanupFailed', { code: 'EBUSY' });
  });
});

describe('bundlePdfs with a broken page tree', () => {
  it('a failing copy names the part like an unreadable file', async () => {
    const spy = vi.spyOn(PDFDocument.prototype, 'copyPages').mockRejectedValue(new Error('broken tree'));
    try {
      await expect(bundlePdfs([{ name: 'Zeugnis 2021', data: await makePdf(1) }]))
        .rejects.toMatchObject({ code: 'CONFLICT', reason: 'attachmentUnreadable', params: { name: 'Zeugnis 2021' } });
    } finally {
      spy.mockRestore();
    }
  });
});
