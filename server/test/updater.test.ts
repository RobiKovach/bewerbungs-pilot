import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { AppError } from '../src/errors.js';
import { nullLogger } from '../src/log.js';
import { Updater, devUpdateSource, devUpdateSourceAllowed, zipUrlFor, type UpdateStep } from '../src/updates/updater.js';
import { parseVersionFile } from '../src/updates/version-file.js';
import { rawZip, type RawEntry } from './helpers/zip.js';

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const GOOD_ENTRIES: RawEntry[] = [
  { name: 'package.json', data: '{"version":"9.9.9"}' },
  { name: 'installer/', data: '' },
  { name: 'installer/install.ps1', data: 'Write-Host hi' },
  { name: 'server/dist/index.js', data: 'console.log(1)' },
];
const GOOD = rawZip(GOOD_ENTRIES);
const GOOD_SHA = sha(GOOD);

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-updater-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const left = () => (fs.existsSync(tmp) ? fs.readdirSync(tmp) : []);
const never = new AbortController().signal;

async function reasonOf(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(AppError); expect((e as AppError).code).toBe('CONFLICT'); return (e as AppError).reason; }
  throw new Error('did not fail');
}

describe('version.json sha256', () => {
  const RELEASES = 'https://github.com/RobiKovach/bewerbungs-pilot/releases/';
  const base = { schema: 1, latest: '0.9.1', released: '2026-11-02', url: `${RELEASES}tag/v0.9.1`, notes: {} };
  it('keeps a valid sha256 and drops a malformed one', () => {
    expect(parseVersionFile({ ...base, sha256: GOOD_SHA })?.sha256).toBe(GOOD_SHA);
    for (const bad of [GOOD_SHA.toUpperCase(), GOOD_SHA.slice(1), `${GOOD_SHA}0`, 'zz', 5, null]) {
      expect(parseVersionFile({ ...base, sha256: bad })).not.toHaveProperty('sha256');
    }
    expect(parseVersionFile(base)).not.toHaveProperty('sha256');
  });
});

describe('devUpdateSourceAllowed', () => {
  it('needs BP_DATA_DIR and fake mail', () => {
    expect(devUpdateSourceAllowed({ BP_DATA_DIR: 'C:\\x', BP_FAKE_MAIL: '1' }, [])).toBe(true);
    expect(devUpdateSourceAllowed({ BP_DATA_DIR: 'C:\\x' }, ['--fake-mail'])).toBe(true);
    expect(devUpdateSourceAllowed({ BP_FAKE_MAIL: '1' }, [])).toBe(false);
    expect(devUpdateSourceAllowed({ BP_DATA_DIR: 'C:\\x' }, [])).toBe(false);
    expect(devUpdateSourceAllowed({ BP_DATA_DIR: '', BP_FAKE_MAIL: '1' }, [])).toBe(false);
    expect(devUpdateSourceAllowed({ BP_DATA_DIR: 'C:\\x', BP_FAKE_MAIL: '0' }, ['--fake-llm'])).toBe(false);
  });
  it('ignores the source with a warning when not allowed', () => {
    const warns: string[] = [];
    const logger = { ...nullLogger, warn: (e: string) => { warns.push(e); } };
    expect(devUpdateSource({ BP_DEV_UPDATE_SOURCE: 'http://127.0.0.1:1/x.zip' }, [], logger)).toBeNull();
    expect(warns).toEqual(['dev_update_source_ignored']);
    expect(devUpdateSource({ BP_DEV_UPDATE_SOURCE: 'http://127.0.0.1:1/x.zip', BP_DATA_DIR: 'C:\\x', BP_FAKE_MAIL: '1' }, [], logger)).toBe('http://127.0.0.1:1/x.zip');
    expect(devUpdateSource({}, [], logger)).toBeNull();
  });
});

describe('zipUrlFor', () => {
  it('builds the one allowed address and refuses a non-version', () => {
    expect(zipUrlFor('0.11.0')).toBe('https://github.com/RobiKovach/bewerbungs-pilot/releases/download/v0.11.0/BewerbungsPilot-v0.11.0.zip');
    expect(() => zipUrlFor('../x')).toThrow(AppError);
  });
});

/** A fake fetch for the GitHub addresses: routes by URL, so redirects to foreign hosts can be tested without a network. */
function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const r = routes[url];
    if (!r) throw new Error(`unexpected request ${url}`);
    return r();
  }) as typeof fetch;
}
const ZIP_URL = zipUrlFor('9.9.9');
const CDN = 'https://objects.githubusercontent.com/abc/file.zip';
const ok = (body: Buffer) => () => new Response(new Uint8Array(body), { status: 200 });
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });

function updater(over: Partial<ConstructorParameters<typeof Updater>[0]> & { sha?: string } = {}) {
  const { sha: s, ...rest } = over;
  return new Updater({
    tmpDir: tmp,
    source: () => ({ version: '9.9.9', zipUrl: ZIP_URL, sha256: s ?? GOOD_SHA }),
    logger: nullLogger,
    ...rest,
  });
}

describe('Updater.prepare — download', () => {
  it('follows a redirect to GitHub CDN, verifies and unpacks; reports the steps; keeps only the release folder', async () => {
    const steps: UpdateStep[] = [];
    const u = updater({ fetch: fakeFetch({ [ZIP_URL]: redirect(CDN), [CDN]: ok(GOOD) }) });
    const { releaseRoot } = await u.prepare((s) => steps.push(s), never);
    expect(steps).toEqual(['downloading', 'verifying', 'extracting']);
    expect(fs.readFileSync(path.join(releaseRoot, 'installer', 'install.ps1'), 'utf8')).toBe('Write-Host hi');
    expect(fs.readFileSync(path.join(releaseRoot, 'server', 'dist', 'index.js'), 'utf8')).toBe('console.log(1)');
    const work = path.dirname(releaseRoot);
    expect(fs.readdirSync(work)).toEqual(['release']);
    expect(path.dirname(work)).toBe(tmp);
  });

  it('refuses a redirect to any other host and cleans up', async () => {
    for (const evil of ['https://evil.example/a.zip', 'http://objects.githubusercontent.com/a.zip', 'https://objects.githubusercontent.com:8443/a.zip', 'https://github.com/other/repo/x.zip']) {
      const u = updater({ fetch: fakeFetch({ [ZIP_URL]: redirect(evil), [evil]: ok(GOOD) }) });
      expect(await reasonOf(u.prepare(() => undefined, never))).toBe('updateDownload');
    }
    expect(left()).toEqual([]);
  });

  it('refuses an announced address that is not the release address', async () => {
    const u = new Updater({
      tmpDir: tmp, logger: nullLogger, fetch: fakeFetch({}),
      source: () => ({ version: '9.9.9', zipUrl: 'https://evil.example/a.zip', sha256: GOOD_SHA }),
    });
    expect(await reasonOf(u.prepare(() => undefined, never))).toBe('updateInvalid');
    expect(left()).toEqual([]);
  });

  it('refuses nothing announced or no checksum', async () => {
    expect(await reasonOf(new Updater({ tmpDir: tmp, logger: nullLogger, source: () => null }).prepare(() => undefined, never))).toBe('updateInvalid');
    expect(await reasonOf(updater({ sha: '' }).prepare(() => undefined, never))).toBe('updateInvalid');
  });

  it('stops after too many redirects and on an HTTP error', async () => {
    const u = updater({ fetch: fakeFetch({ [ZIP_URL]: redirect(CDN), [CDN]: redirect(CDN) }) });
    expect(await reasonOf(u.prepare(() => undefined, never))).toBe('updateDownload');
    const v = updater({ fetch: fakeFetch({ [ZIP_URL]: () => new Response('no', { status: 404 }) }) });
    expect(await reasonOf(v.prepare(() => undefined, never))).toBe('updateDownload');
    expect(left()).toEqual([]);
  });

  it('aborts when the caller aborts', async () => {
    const ctrl = new AbortController();
    const hanging = (async (_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
    })) as typeof fetch;
    const p = updater({ fetch: hanging }).prepare(() => undefined, ctrl.signal);
    setTimeout(() => ctrl.abort(), 20);
    expect(await reasonOf(p)).toBe('updateDownload');
    expect(left()).toEqual([]);
  });
});

describe('Updater.prepare — real HTTP (dev source)', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const p = req.url ?? '/';
      if (p === '/good.zip') { res.writeHead(200, { 'content-length': GOOD.length }); res.end(GOOD); return; }
      if (p === '/redirect') { res.writeHead(302, { location: '/good.zip' }); res.end(); return; }
      if (p === '/away') { res.writeHead(302, { location: 'http://localhost:1/good.zip' }); res.end(); return; }
      if (p === '/huge.zip') {
        // Chunked, no Content-Length at all (a lying header cannot be sent by node): the bytes are counted, not announced.
        res.writeHead(200);
        const chunk = Buffer.alloc(64 * 1024, 1);
        let sent = 0;
        const pump = () => { while (sent < 40) { sent++; if (!res.write(chunk)) { res.once('drain', pump); return; } } res.end(); };
        pump();
        return;
      }
      if (p === '/slow.zip') { res.writeHead(200); res.write('PK'); return; } // never ends
      res.writeHead(404); res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('downloads from the dev source, also through a same-origin redirect', async () => {
    for (const p of ['/good.zip', '/redirect']) {
      const { releaseRoot } = await updater({ devSource: `${base}${p}` }).prepare(() => undefined, never);
      expect(fs.existsSync(path.join(releaseRoot, 'installer', 'install.ps1'))).toBe(true);
    }
  });

  it('refuses a dev redirect to another origin', async () => {
    expect(await reasonOf(updater({ devSource: `${base}/away` }).prepare(() => undefined, never))).toBe('updateDownload');
    expect(left()).toEqual([]);
  });

  it('refuses a stream over the size limit even when Content-Length says it is small', async () => {
    const u = updater({ devSource: `${base}/huge.zip`, limits: { maxZipBytes: 1024 * 1024 } });
    expect(await reasonOf(u.prepare(() => undefined, never))).toBe('updateDownload');
    expect(left()).toEqual([]);
  });

  it('times out a download that never ends and removes the temp files', async () => {
    const u = updater({ devSource: `${base}/slow.zip`, limits: { timeoutMs: 150 } });
    expect(await reasonOf(u.prepare(() => undefined, never))).toBe('updateDownload');
    expect(left()).toEqual([]);
  });

  it('a 404 is a download failure', async () => {
    expect(await reasonOf(updater({ devSource: `${base}/none.zip` }).prepare(() => undefined, never))).toBe('updateDownload');
  });
});

describe('Updater.prepare — checksum and archive', () => {
  const serve = (zip: Buffer) => fakeFetch({ [ZIP_URL]: ok(zip) });

  it('a wrong sha256 is refused and the zip deleted', async () => {
    const u = updater({ fetch: serve(GOOD), sha: '0'.repeat(64) });
    expect(await reasonOf(u.prepare(() => undefined, never))).toBe('updateChecksum');
    expect(left()).toEqual([]);
  });

  it.each([
    ['dot-dot', [...GOOD_ENTRIES, { name: '../x', data: 'x' }]],
    ['nested dot-dot', [...GOOD_ENTRIES, { name: 'a/../../x', data: 'x' }]],
    ['absolute path', [...GOOD_ENTRIES, { name: '/etc/x', data: 'x' }]],
    ['drive path', [...GOOD_ENTRIES, { name: 'C:/x', data: 'x' }]],
    ['backslashes (Compress-Archive style)', [{ name: 'installer\\install.ps1', data: 'x' }, { name: 'package.json', data: '{}' }]],
    ['symlink', [...GOOD_ENTRIES, { name: 'link', data: 'target', unixMode: 0o120777 }]],
    ['duplicate (case-insensitive)', [...GOOD_ENTRIES, { name: 'Package.json', data: '{}' }]],
    ['no installer', [{ name: 'package.json', data: '{}' }, { name: 'server/dist/index.js', data: 'x' }]],
    ['installer only as a folder', [{ name: 'installer/', data: '' }, { name: 'installer/other.txt', data: 'x' }]],
    ['entry bigger than declared', [...GOOD_ENTRIES, { name: 'liar.bin', data: Buffer.alloc(5000, 1), declaredSize: 10 }]],
  ] as Array<[string, RawEntry[]]>)('refuses an archive with %s', async (_label, entries) => {
    const zip = rawZip(entries);
    const u = updater({ fetch: serve(zip), sha: sha(zip) });
    expect(await reasonOf(u.prepare(() => undefined, never))).toBe('updateInvalid');
    expect(left()).toEqual([]);
  });

  it('refuses something that is not a zip at all', async () => {
    const junk = Buffer.from('this is not a zip');
    const u = updater({ fetch: serve(junk), sha: sha(junk) });
    expect(await reasonOf(u.prepare(() => undefined, never))).toBe('updateInvalid');
    expect(left()).toEqual([]);
  });
});

describe('scripts/pack-zip.mjs (release packing)', () => {
  it('packs a folder with forward-slash names and the Updater accepts the result', async () => {
    const { pathToFileURL, fileURLToPath } = await import('node:url');
    const mod = (await import(pathToFileURL(fileURLToPath(new URL('../../scripts/pack-zip.mjs', import.meta.url))).href)) as {
      packFolder: (folder: string, zip: string) => Promise<void>;
    };
    const src = path.join(tmp, 'src');
    fs.mkdirSync(path.join(src, 'installer'), { recursive: true });
    fs.mkdirSync(path.join(src, 'server', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(src, 'install.bat'), '@echo off');
    fs.writeFileSync(path.join(src, 'installer', 'install.ps1'), 'Write-Host hi');
    fs.writeFileSync(path.join(src, 'server', 'dist', 'index.js'), 'x');
    const zipFile = path.join(tmp, 'rel.zip');
    await mod.packFolder(src, zipFile);
    const zip = fs.readFileSync(zipFile);
    expect(zip.includes(Buffer.from('installer/install.ps1'))).toBe(true);
    expect(zip.includes(Buffer.from(['installer', 'install.ps1'].join(String.fromCharCode(92))))).toBe(false);
    const work = path.join(tmp, 'work');
    const u = updater({ tmpDir: work, fetch: fakeFetch({ [ZIP_URL]: ok(zip) }), sha: sha(zip) });
    const { releaseRoot } = await u.prepare(() => undefined, never);
    expect(fs.readFileSync(path.join(releaseRoot, 'installer', 'install.ps1'), 'utf8')).toBe('Write-Host hi');
    expect(fs.readFileSync(path.join(releaseRoot, 'install.bat'), 'utf8')).toBe('@echo off');
  });
});

describe('Updater.prepare — local failures', () => {
  it('a write failure while saving (zip path unwritable) is an updateDownload error, not a crash, and cleans up', async () => {
    // Make the zip path a folder in advance: createWriteStream('wx') then fails with EEXIST/EISDIR after the response began.
    const u = updater({ fetch: fakeFetch({ [ZIP_URL]: () => { fs.mkdirSync(path.join(tmp, fs.readdirSync(tmp)[0]!, 'update.zip')); return new Response(new Uint8Array(GOOD), { status: 200 }); } }) });
    const unhandled: unknown[] = [];
    const h = (e: unknown) => unhandled.push(e);
    process.on('uncaughtException', h);
    try {
      expect(await reasonOf(u.prepare(() => undefined, never))).toBe('updateDownload');
      await new Promise((r) => setTimeout(r, 50));
    } finally { process.off('uncaughtException', h); }
    expect(unhandled).toEqual([]);
    expect(left()).toEqual([]);
  });

  it('an unusable temp folder is an updateDownload error, not updateInvalid', async () => {
    const file = path.join(tmp, 'file');
    fs.writeFileSync(file, 'x');
    const u = updater({ tmpDir: path.join(file, 'sub'), fetch: fakeFetch({ [ZIP_URL]: ok(GOOD) }) });
    expect(await reasonOf(u.prepare(() => undefined, never))).toBe('updateDownload');
  });
});

describe('scripts/check-versions.mjs (release guard)', () => {
  it('accepts equal versions and refuses when root, server and web differ', async () => {
    const { pathToFileURL, fileURLToPath } = await import('node:url');
    const { checkVersions } = (await import(pathToFileURL(fileURLToPath(new URL('../../scripts/check-versions.mjs', import.meta.url))).href)) as {
      checkVersions: (v: Record<string, string>) => void;
    };
    expect(() => checkVersions({ 'package.json': '0.11.0', 'server/package.json': '0.11.0', 'web/package.json': '0.11.0' })).not.toThrow();
    expect(() => checkVersions({ 'package.json': '0.11.0', 'server/package.json': '0.10.1', 'web/package.json': '0.11.0' })).toThrow(/versions differ.*server\/package\.json=0\.10\.1/);
    expect(() => checkVersions({ 'package.json': '0.11.0', 'server/package.json': '0.11.0', 'web/package.json': '0.10.1' })).toThrow(/versions differ/);
  });
});
