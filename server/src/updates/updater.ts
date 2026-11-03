import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { MAX_ENTRIES, isSymlink, nameProblem } from '../backup/format.js';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';

export type UpdateStep = 'downloading' | 'verifying' | 'extracting';

const REPO = 'https://github.com/RobiKovach/bewerbungs-pilot/releases/download/';
/** GitHub redirects release downloads to its CDN; nothing else is followed. */
const CDN_HOSTS = new Set(['objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 300 * 1024 * 1024;
const TOTAL_TIMEOUT_MS = 5 * 60_000;
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const SEMVER = /^\d+\.\d+\.\d+$/;
const MARKER = 'installer/install.ps1';

type Reason = 'updateDownload' | 'updateChecksum' | 'updateInvalid';
const fail = (reason: Reason, log = '') => new AppError('CONFLICT', log, reason);

/** The only address an update is downloaded from. */
export function zipUrlFor(version: string): string {
  if (!SEMVER.test(version)) throw fail('updateInvalid', `bad version ${version}`);
  return `${REPO}v${version}/BewerbungsPilot-v${version}.zip`;
}

/**
 * A development update source (a local zip URL) is honoured only when the server runs on a throw-away data folder
 * AND without real mail — mirrors how index.ts decides on fake mail. Never from settings or a request.
 */
export function devUpdateSourceAllowed(env: NodeJS.ProcessEnv, argv: readonly string[]): boolean {
  const dataDir = env.BP_DATA_DIR;
  return typeof dataDir === 'string' && dataDir !== '' && (argv.includes('--fake-mail') || env.BP_FAKE_MAIL === '1');
}

/** `BP_DEV_UPDATE_SOURCE` when allowed; set but not allowed means ignored, with a warning. */
export function devUpdateSource(env: NodeJS.ProcessEnv, argv: readonly string[], logger: Logger): string | null {
  const src = env.BP_DEV_UPDATE_SOURCE;
  if (!src) return null;
  if (!devUpdateSourceAllowed(env, argv)) {
    logger.warn('dev_update_source_ignored', { reason: 'needs BP_DATA_DIR and fake mail' });
    return null;
  }
  return src;
}

export interface UpdaterDeps {
  tmpDir: string;
  source: () => { version: string; zipUrl: string; sha256: string } | null;
  fetch?: typeof fetch;
  logger: Logger;
  /** Development only (see devUpdateSource): download this URL instead, from this origin only. */
  devSource?: string | null;
  /** Tests. */
  limits?: { maxZipBytes?: number; timeoutMs?: number };
}

/**
 * Downloads the release zip of the announced version, checks its sha256 and unpacks it into a fresh folder under
 * `tmpDir` (spec 0.11.0, "Оновлення в один клік"). It never installs anything: the caller runs the installer from
 * `releaseRoot`. On any failure everything it created is removed.
 */
export class Updater {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly d: UpdaterDeps) {
    this.fetchFn = d.fetch ?? fetch;
  }

  async prepare(onStep: (s: UpdateStep) => void, signal: AbortSignal): Promise<{ releaseRoot: string }> {
    const src = this.d.source();
    if (!src) throw fail('updateInvalid', 'no update announced');
    const dev = this.d.devSource ?? null;
    if (!dev && src.zipUrl !== zipUrlFor(src.version)) throw fail('updateInvalid', 'unexpected zip address');
    if (!/^[0-9a-f]{64}$/.test(src.sha256)) throw fail('updateInvalid', 'no checksum');

    let work: string;
    try {
      await fs.promises.mkdir(this.d.tmpDir, { recursive: true });
      work = await fs.promises.mkdtemp(path.join(this.d.tmpDir, 'update-'));
    } catch (err) {
      throw fail('updateDownload', `temp folder: ${String(err)}`);
    }
    try {
      const zip = path.join(work, 'update.zip');
      onStep('downloading');
      await this.download(dev ?? src.zipUrl, dev, zip, signal);
      onStep('verifying');
      if ((await sha256Of(zip)) !== src.sha256) throw fail('updateChecksum', 'sha256 differs');
      onStep('extracting');
      const releaseRoot = path.join(work, 'release');
      await extractRelease(zip, releaseRoot);
      await fs.promises.rm(zip, { force: true });
      return { releaseRoot };
    } catch (err) {
      await fs.promises.rm(work, { recursive: true, force: true }).catch(() => undefined);
      this.d.logger.warn('update_prepare_failed', { reason: err instanceof AppError ? (err.reason ?? err.code) : 'unknown' });
      throw err instanceof AppError ? err : fail('updateDownload', String(err));
    }
  }

  private async download(url: string, devUrl: string | null, file: string, signal: AbortSignal): Promise<void> {
    const timeout = this.d.limits?.timeoutMs ?? TOTAL_TIMEOUT_MS;
    const max = this.d.limits?.maxZipBytes ?? MAX_ZIP_BYTES;
    const all = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    const devOrigin = devUrl ? new URL(devUrl).origin : null;
    try {
      let current = url;
      for (let hop = 0; ; hop++) {
        if (hop > MAX_REDIRECTS) throw fail('updateDownload', 'too many redirects');
        this.checkAddress(current, hop, devOrigin);
        const res = await this.fetchFn(current, { redirect: 'manual', signal: all, headers: { 'user-agent': 'BewerbungsPilot' } });
        if (REDIRECTS.has(res.status)) {
          await res.body?.cancel().catch(() => undefined);
          const loc = res.headers.get('location');
          if (!loc) throw fail('updateDownload', 'redirect without location');
          current = new URL(loc, current).href;
          continue;
        }
        if (!res.ok || !res.body) throw fail('updateDownload', `HTTP ${res.status}`);
        await this.save(res.body, file, max);
        return;
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw fail('updateDownload', all.aborted ? 'aborted or timed out' : String(err));
    }
  }

  /** Hop 0 is exactly our release address; later hops only GitHub's CDN over https. Dev: that one origin. */
  private checkAddress(url: string, hop: number, devOrigin: string | null): void {
    let u: URL;
    try { u = new URL(url); } catch { throw fail('updateDownload', 'bad address'); }
    if (devOrigin) {
      if (u.origin !== devOrigin) throw fail('updateDownload', 'redirect outside the dev source');
      return;
    }
    if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') throw fail('updateDownload', 'not plain https');
    const ok = hop === 0 ? u.hostname === 'github.com' && u.href.startsWith(REPO) : CDN_HOSTS.has(u.hostname);
    if (!ok) throw fail('updateDownload', `host not allowed: ${u.hostname}`);
  }

  /** Streams to disk and counts the bytes itself — `Content-Length` is not trusted. pipeline() owns every stream error. */
  private async save(body: ReadableStream<Uint8Array>, file: string, max: number): Promise<void> {
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > max) cb(fail('updateDownload', 'too large'));
        else cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>), counter, fs.createWriteStream(file, { flags: 'wx' }));
  }
}

async function sha256Of(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/** Same entry rules as a backup (names, symlinks, duplicates, counts, sizes), plus: the release must hold the installer. */
async function extractRelease(file: string, root: string): Promise<void> {
  let zip: ZipFile | null = null;
  try {
    // strictFileNames: keep `\` in names as-is, so the name check refuses it.
    zip = await yauzl.openPromise(file, { decodeStrings: true, validateEntrySizes: true, strictFileNames: true, autoClose: false });
    if (zip.entryCount > MAX_ENTRIES) throw fail('updateInvalid', `${zip.entryCount} entries`);
    const entries: Entry[] = [];
    const seen = new Set<string>();
    let total = 0;
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      const problem = nameProblem(name);
      if (problem) throw fail('updateInvalid', `${name}: ${problem}`);
      if (isSymlink(entry.externalFileAttributes)) throw fail('updateInvalid', `${name}: symlink`);
      const key = name.toLowerCase();
      if (seen.has(key)) throw fail('updateInvalid', `${name}: duplicate`);
      seen.add(key);
      total += entry.uncompressedSize;
      if (total > MAX_UNPACKED_BYTES) throw fail('updateInvalid', 'unpacked size too large');
      entries.push(entry);
    }
    if (!seen.has(MARKER)) throw fail('updateInvalid', `no ${MARKER}`);

    const abs = path.resolve(root);
    await fs.promises.mkdir(abs, { recursive: true });
    for (const entry of entries) {
      const target = path.resolve(abs, ...entry.fileName.split('/').filter(Boolean));
      if (!target.startsWith(abs + path.sep)) throw fail('updateInvalid', `outside folder: ${entry.fileName}`);
      if (entry.fileName.endsWith('/')) { await fs.promises.mkdir(target, { recursive: true }); continue; }
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const input = await zip.openReadStreamPromise(entry);
      await pipeline(input, fs.createWriteStream(target, { flags: 'wx' }));
    }
  } catch (err) {
    throw err instanceof AppError ? err : fail('updateInvalid', String(err));
  } finally {
    if (zip?.isOpen) zip.close();
  }
}
