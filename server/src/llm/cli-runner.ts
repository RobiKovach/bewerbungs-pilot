import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors.js';
import { nullLogger, type Logger } from '../log.js';
import type { Availability } from './types.js';

export interface CliCommand { file: string; argsPrefix: string[] }
export interface RunOutput { stdout: string; stderr: string; exitCode: number | null }

export interface RunCliOptions {
  command: CliCommand;
  args: string[];
  /** Built after the input files are staged, so the prompt can list them. */
  stdin: (inputs: string[]) => string;
  files?: readonly string[];
  /** Parent of the per-run working folders. Must NOT be os.tmpdir() (8.3 short paths are blocked by Claude Code). */
  tmpRoot: string;
  timeoutMs: number;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  /** How long to wait for 'close' after killing the process before giving up anyway. Default 5000. Overridable for tests. */
  killGraceMs?: number;
  /** Overrides killTree — test hook for simulating a kill that does not actually stop the process. */
  kill?: (child: ChildProcess, logger: Logger) => void;
}

/** Sub-folder of the per-run folder where input files are copied (see LlmTask.files). */
export const INPUT_DIR = 'input';
// If taskkill/SIGKILL doesn't make the process emit 'close' within this long, give up waiting anyway —
// otherwise a stuck grandchild holding the stdio pipes open would freeze the single-process FIFO queue forever.
const DEFAULT_KILL_GRACE_MS = 5000;
const AVAILABILITY_TTL_MS = 10 * 60 * 1000;

/**
 * Copies the task's input files into <runDir>/input/ as file-1.<ext>, file-2.<ext>, ... and returns those relative
 * paths. Neutral names keep user-controlled file names out of the prompt.
 */
export function stageInputFiles(runDir: string, files: readonly string[]): string[] {
  if (files.length === 0) return [];
  const dir = path.join(runDir, INPUT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return files.map((file, i) => {
    const ext = path.extname(file).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const name = `file-${i + 1}${ext}`;
    fs.copyFileSync(path.resolve(file), path.join(dir, name));
    return `${INPUT_DIR}/${name}`;
  });
}

// On Windows child.kill() would leave grandchildren running; taskkill /T kills the whole tree.
export function killTree(child: ChildProcess, logger: Logger = nullLogger): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    tk.on('error', (err) => logger.warn('taskkill_failed', { message: err.message }));
    tk.on('close', (code) => {
      if (code !== 0) logger.warn('taskkill_nonzero', { code });
    });
  } else {
    child.kill('SIGKILL');
  }
}

/** Remembers the last availability probe for a while, so the UI does not start the CLI on every status check. */
export class AvailabilityCache {
  private cached: { value: Availability; at: number } | null = null;

  constructor(private readonly ttlMs: number = AVAILABILITY_TTL_MS) {}

  async get(refresh: boolean, probe: () => Promise<Availability>): Promise<Availability> {
    const c = this.cached;
    if (!refresh && c && Date.now() - c.at < this.ttlMs) return c.value;
    const value = await probe();
    this.cached = { value, at: Date.now() };
    return value;
  }

  clear(): void {
    this.cached = null;
  }
}

export function runCli(o: RunCliOptions): Promise<RunOutput> {
  const { signal, timeoutMs } = o;
  const logger = o.logger ?? nullLogger;
  if (signal.aborted) return Promise.reject(new AppError('LLM_CANCELLED', 'aborted before start'));

  let cwd: string;
  try {
    fs.mkdirSync(o.tmpRoot, { recursive: true });
    cwd = fs.mkdtempSync(path.join(o.tmpRoot, 'run-'));
  } catch (err) {
    return Promise.reject(new AppError('DATA_WRITE_FAILED', err instanceof Error ? err.message : String(err)));
  }
  let inputs: string[];
  try {
    inputs = stageInputFiles(cwd, o.files ?? []);
  } catch (err) {
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
    return Promise.reject(new AppError('DATA_WRITE_FAILED', `could not copy an input file: ${err instanceof Error ? err.message : String(err)}`));
  }

  return new Promise<RunOutput>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let stopReason: 'timeout' | 'cancelled' | null = null;
    let settled = false;
    let graceTimer: NodeJS.Timeout | null = null;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(o.command.file, [...o.command.argsPrefix, ...o.args], {
        cwd,
        env: o.env ?? process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
      reject(new AppError('LLM_FAILED', err instanceof Error ? err.message : String(err)));
      return;
    }

    // Best-effort folder removal, callable more than once: right after a kill the OS may still
    // have the folder locked by the still-dying (or, if the kill genuinely failed, still-live)
    // process, so a first attempt can silently no-op — retried unconditionally on 'close' below.
    const cleanup = () => {
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      signal.removeEventListener('abort', onAbort);
      cleanup();
      fn();
    };

    const stop = (reason: 'timeout' | 'cancelled') => {
      if (stopReason) return;
      stopReason = reason;
      (o.kill ?? killTree)(child, logger);
      // Belt-and-braces: if the kill itself fails silently (taskkill error, or a grandchild
      // keeping the stdio pipes open) 'close' may never fire — don't let that freeze the
      // single-process FIFO queue forever.
      graceTimer = setTimeout(() => {
        finish(() =>
          reject(
            new AppError(
              reason === 'timeout' ? 'LLM_TIMEOUT' : 'LLM_CANCELLED',
              reason === 'timeout' ? `no answer within ${timeoutMs} ms (and did not exit after being killed)` : 'cancelled by the user (and did not exit after being killed)',
            ),
          ),
        );
      }, o.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
    };
    const onAbort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { if (stderr.length < 65_536) stderr += chunk; });
    child.stdin.on('error', () => { /* the child may exit before reading stdin */ });
    child.stdin.end(o.stdin(inputs), 'utf8');

    child.on('error', (err: NodeJS.ErrnoException) =>
      finish(() => reject(new AppError(err.code === 'ENOENT' ? 'LLM_NOT_INSTALLED' : 'LLM_FAILED', err.message))),
    );
    child.on('close', (exitCode) => {
      // Retry cleanup unconditionally: if the promise already settled via the grace timer, the
      // process has (by definition) only just now actually exited, so this is the first chance
      // the folder can actually be removed.
      cleanup();
      finish(() => {
        if (stopReason === 'timeout') {
          reject(new AppError('LLM_TIMEOUT', `no answer within ${timeoutMs} ms`, 'llmTimeout', { seconds: Math.round(timeoutMs / 1000) }));
        } else if (stopReason === 'cancelled') reject(new AppError('LLM_CANCELLED', 'cancelled by the user', 'cancelledByUser'));
        else resolve({ stdout, stderr, exitCode });
      });
    });
  });
}
