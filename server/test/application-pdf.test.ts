import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { bundlePdfs, countPages, findBrowser } from '../src/applications/pdf.js';
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
