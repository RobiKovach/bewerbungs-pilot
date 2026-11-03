import fs from 'node:fs';
import path from 'node:path';
import type { UpdateFailure, UpdateProgress } from '@bp/shared';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';
import type { Activity } from '../runtime/activity.js';
import type { AvailableUpdate } from './checker.js';
import type { Updater, UpdateStep } from './updater.js';
import { isNewer } from './version-file.js';

/** Folders `update-*` older than this are removed at start (a just-finished installer may still run from its folder). */
const OLD_UPDATE_FOLDER_MS = 30 * 60_000;
/** A status file still saying "running" after this long: the installer died without writing its end. */
const STALE_RUNNING_MS = 10 * 60_000;

/** What the installer left in `update-status.json` for the previous run, read once at start. */
export interface UpdateOutcomeData { justUpdated?: string; lastUpdateError?: UpdateFailure }

/**
 * Reads `update-status.json` once, keeps the answer in memory and deletes the file. `done` → the version we are now;
 * `failed` / `rolledBack` → why it did not work; `running` for long → the installer was interrupted; `running` for a
 * short time is left alone (an installer may still be working on it).
 */
export function readUpdateOutcome(file: string, logger: Logger, now: () => number = Date.now): UpdateOutcome {
  return new UpdateOutcome(evaluateStatusFile(file, logger, now()).data, { file, logger, now });
}

interface Evaluated { data: UpdateOutcomeData; pending: boolean }

/** One look at the file: a final state is returned and the file deleted; a young `running` is pending and left alone. */
function evaluateStatusFile(file: string, logger: Logger, now: number): Evaluated {
  let raw: unknown;
  try {
    const text = fs.readFileSync(file, 'utf8');
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('update_status_unreadable', { code: (err as NodeJS.ErrnoException).code ?? 'PARSE' });
      fs.rmSync(file, { force: true });
    }
    return { data: {}, pending: false };
  }
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const state = s.state;
  const at = typeof s.at === 'string' ? Date.parse(s.at) : NaN;
  const error = typeof s.error === 'string' ? s.error : '';
  let data: UpdateOutcomeData = {};
  if (state === 'done' && typeof s.to === 'string' && /^\d+\.\d+\.\d+$/.test(s.to)) {
    data = { justUpdated: s.to };
  } else if (state === 'failed' || state === 'rolledBack') {
    // The installer's own words go to the log only; the person gets a fixed sentence per kind.
    data = { lastUpdateError: /^rollback failed/i.test(error) ? 'rollbackFailed' : 'failed' };
    logger.warn('update_failed', { state, step: typeof s.step === 'string' ? s.step : null, error: error.slice(0, 300) });
  } else if (state === 'running') {
    if (Number.isFinite(at) && now - at < STALE_RUNNING_MS) return { data: {}, pending: true };
    data = { lastUpdateError: 'interrupted' };
    logger.warn('update_interrupted', { step: typeof s.step === 'string' ? s.step : null });
  }
  fs.rmSync(file, { force: true });
  return { data, pending: false };
}

/**
 * What the installer reported. The installer writes `running` just before it starts the new app and `done` only after
 * the new app answered — so the new server starts while the file still says `running`. `take()` therefore looks at the
 * file again each time until it reaches a final state, and hands the result out once. `updatePending` tells the page
 * to ask again soon.
 */
export class UpdateOutcome {
  constructor(
    private data: UpdateOutcomeData,
    private readonly src?: { file: string; logger: Logger; now: () => number },
  ) {
    this.pending = false;
  }

  private pending: boolean;

  take(): UpdateOutcomeData & { updatePending?: true } {
    if (Object.keys(this.data).length === 0 && this.src) {
      const r = evaluateStatusFile(this.src.file, this.src.logger, this.src.now());
      this.data = r.data;
      this.pending = r.pending;
    }
    const d = this.data;
    this.data = {};
    if (Object.keys(d).length === 0 && this.pending) return { updatePending: true };
    this.pending = false;
    return d;
  }
}

/** Removes `update-*` folders under `dir` older than 30 minutes. Never throws. */
export function cleanOldUpdateFolders(dir: string, logger: Logger, now: number = Date.now()): void {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.startsWith('update-')) continue;
    const full = path.join(dir, name);
    try {
      if (now - fs.statSync(full).mtimeMs > OLD_UPDATE_FOLDER_MS) fs.rmSync(full, { recursive: true, force: true });
    } catch (err) {
      logger.warn('update_folder_cleanup_failed', { code: (err as NodeJS.ErrnoException).code ?? 'UNKNOWN' });
    }
  }
}

export interface SpawnOptions { detached: true; stdio: 'ignore'; windowsHide: true; cwd: string }

export interface UpdateApplierDeps {
  updater: Pick<Updater, 'prepare'>;
  activity: Activity;
  available: () => AvailableUpdate | null;
  version: string;
  /** Whether the check for updates is switched on (the banner is not shown otherwise, so nothing to install either). */
  enabled: () => boolean;
  /** `<data>\update-status.json`: where the installer reports. */
  statusFile: string;
  /** Other work that must finish first; each returns its name for the sentence or null. */
  busy: () => string | null;
  /** Starts the installer (detached). Injected: tests never run anything. */
  spawn: (file: string, args: string[], opts: SpawnOptions) => Promise<void>;
  /** Full path of Windows PowerShell (no PATH search). */
  powershell?: string;
  /** The server's normal shutdown path. */
  shutdown: () => void;
  pid?: number;
  logger: Logger;
}

const WINDOWS_POWERSHELL = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

type Step = UpdateStep | 'installing';

/**
 * "Update now" (spec 0.11.0): downloads and checks the release, starts the unattended installer and quits so that the
 * installer can replace the program. A failure before the installer starts leaves the old app running untouched.
 */
export class UpdateApplier {
  private current: UpdateProgress = { state: 'idle' };

  constructor(private readonly d: UpdateApplierDeps) {}

  progress(): UpdateProgress {
    return { ...this.current };
  }

  /** Throws the 409s; otherwise starts the work in the background and returns. */
  apply(): void {
    this.d.activity.refuseDuringUpdate();
    const a = this.d.available();
    if (!this.d.enabled() || !a || !a.sha256 || !isNewer(a.version, this.d.version)) {
      throw new AppError('CONFLICT', 'no installable update', 'noUpdate');
    }
    const what = this.d.busy();
    if (what) throw new AppError('CONFLICT', `busy: ${what}`, 'busy', { what });
    const end = this.d.activity.begin('update');
    this.current = { state: 'downloading' };
    void this.run(end);
  }

  private set(step: Step): void {
    this.current = { state: step };
  }

  private async run(end: () => void): Promise<void> {
    try {
      // Nothing aborts a running update (no Cancel button in the spec), so the signal never fires.
      const { releaseRoot } = await this.d.updater.prepare((s) => this.set(s), new AbortController().signal);
      this.set('installing');
      const script = path.join(releaseRoot, 'installer', 'install.ps1');
      const work = path.dirname(releaseRoot);
      try {
        // Own folder as the working directory: never from inside the program folder the installer replaces.
        await this.d.spawn(this.d.powershell ?? WINDOWS_POWERSHELL(), [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
        '-Unattended', '-StatusFile', this.d.statusFile, '-WaitPid', String(this.d.pid ?? process.pid),
      ], { detached: true, stdio: 'ignore', windowsHide: true, cwd: work });
      } catch (err) {
        // The installer did not start: the old app keeps running, the unpacked release is not needed.
        if (path.basename(work).startsWith('update-')) fs.rmSync(work, { recursive: true, force: true, maxRetries: 2 });
        throw new AppError('CONFLICT', `installer did not start: ${String(err)}`, 'updateStart');
      }
      this.d.logger.info('update_installer_started', {});
      // `activity` stays open: this server is going away and must not accept new work meanwhile.
      this.d.shutdown();
    } catch (err) {
      end();
      const reason = err instanceof AppError ? err.reason : undefined;
      this.d.logger.warn('update_apply_failed', { reason: reason ?? 'unknown' });
      this.current = { state: 'failed', error: reason ?? 'unknown' };
    }
  }
}
