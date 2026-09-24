import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError, type ErrorCode } from '../errors.js';
import { nullLogger, type Logger } from '../log.js';
import { composePrompt } from '../prompts/languages.js';
import type { Availability, LlmProvider, LlmTask } from './types.js';
import { validateOutput } from './validate.js';

export interface ClaudeCommand { file: string; argsPrefix: string[] }

export interface ClaudeCodeProviderOptions {
  /** Parent of the per-run working folders. Must NOT be os.tmpdir() (8.3 short paths are blocked by Claude Code). */
  tmpRoot: string;
  timeoutMs: () => number;
  /** undefined = auto-detect with resolveClaudeCommand(); null = "not installed". */
  command?: ClaudeCommand | null;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  /** How long to wait for 'close' after killing the process before giving up anyway. Default 5000. Overridable for tests. */
  killGraceMs?: number;
  /** Overrides killTree — test hook for simulating a kill that does not actually stop the process. */
  kill?: (child: ChildProcess, logger: Logger) => void;
}

interface RunOutput { stdout: string; stderr: string; exitCode: number | null }

// Isolation from the user's own Claude Code setup (all listed by `claude --help`, CLI 2.1.281):
// --restricted            ignores user/project/local settings (their allow rules), drops the command-running tools
//                         and WebFetch, and confines file tools to the working folder (the per-run folder).
// --strict-mcp-config     with no --mcp-config: no MCP servers at all.
// --safe-mode             no CLAUDE.md, skills, plugins, hooks, custom agents/commands, output styles. (--bare would
//                         also do this but never reads the OAuth sign-in, which is how most users are logged in.)
// --disable-slash-commands  no skills.
// --no-session-persistence  no transcript left in ~/.claude/projects (outside our data folder).
const ISOLATION_FLAGS = ['--restricted', '--strict-mcp-config', '--safe-mode', '--disable-slash-commands', '--no-session-persistence'];
// Second layer, in case a CLI version ignores one of the flags above. 'Task' is the old name of 'Agent'.
const DISALLOWED_TOOLS = ['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'Task', 'Agent'];
/** Sub-folder of the per-run folder where input files are copied (see LlmTask.files). */
export const INPUT_DIR = 'input';
const AUTH_ERROR_RE = /not logged in|\/login|invalid api key|unauthori[sz]ed/i;
const AVAILABILITY_TTL_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 60_000;
// If taskkill/SIGKILL doesn't make the process emit 'close' within this long, give up waiting anyway —
// otherwise a stuck grandchild holding the stdio pipes open would freeze the single-process FIFO queue forever.
const DEFAULT_KILL_GRACE_MS = 5000;
const PROBE_TASK: LlmTask = {
  prompt: 'Answer with ok = true.',
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
  replyLanguage: 'en',
};

function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

export function resolveClaudeCommand(env: NodeJS.ProcessEnv = process.env): ClaudeCommand | null {
  const win = process.platform === 'win32';
  const exeName = win ? 'claude.exe' : 'claude';
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const home = env.USERPROFILE ?? env.HOME ?? os.homedir();
  const candidates = dirs.map((dir) => path.join(dir, exeName));
  if (win) {
    for (const dir of dirs) {
      if (isFile(path.join(dir, 'claude.cmd'))) {
        candidates.push(path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
      }
    }
  }
  candidates.push(path.join(home, '.local', 'bin', exeName));
  const found = candidates.find(isFile);
  // Resolve so a relative PATH entry is anchored to the current process cwd, not to whatever
  // per-run working folder the returned command is later spawned from.
  return found ? { file: path.resolve(found), argsPrefix: [] } : null;
}

export function buildClaudeArgs(task: LlmTask, extra: string[] = []): string[] {
  const allowed = ['Read', ...(task.allowWebSearch ? ['WebSearch'] : [])];
  // No --add-dir: input files are copied into the run folder (stageInputFiles), so Read never needs, and never
  // gets, access to the folder the user's originals live in.
  return [
    '-p', '--output-format', 'json', '--json-schema', JSON.stringify(task.schema),
    '--permission-mode', 'dontAsk', ...ISOLATION_FLAGS, ...extra,
    '--tools', allowed.join(','),
    '--allowedTools', ...allowed,
    '--disallowedTools', ...DISALLOWED_TOOLS,
  ];
}

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

function promptWithInputs(task: LlmTask, inputs: string[]): string {
  const base = composePrompt(task);
  if (inputs.length === 0) return base;
  const list = inputs.map((f) => `- ${f}`).join('\n');
  return `${base}\n\nInput files (in your working folder; read them with the Read tool):\n${list}`;
}

type Parsed = { ok: true; value: unknown } | { ok: false; code: ErrorCode; detail: string };

export function parseClaudeOutput(stdout: string, stderr: string, exitCode: number | null): Parsed {
  const all = `${stdout}\n${stderr}`.trim();
  let obj: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
  } catch {
    // handled below
  }
  if (!obj) {
    if (AUTH_ERROR_RE.test(all)) return { ok: false, code: 'CLAUDE_NOT_LOGGED_IN', detail: all.slice(0, 2000) };
    return { ok: false, code: exitCode === 0 ? 'LLM_BAD_OUTPUT' : 'LLM_FAILED', detail: all.slice(0, 2000) };
  }
  if (obj.is_error === true || (obj.subtype !== undefined && obj.subtype !== 'success')) {
    const msg = String(obj.result ?? obj.subtype ?? 'error');
    return { ok: false, code: AUTH_ERROR_RE.test(msg) ? 'CLAUDE_NOT_LOGGED_IN' : 'LLM_FAILED', detail: msg.slice(0, 2000) };
  }
  if (obj.structured_output !== undefined) return { ok: true, value: obj.structured_output };
  if (typeof obj.result === 'string') {
    try { return { ok: true, value: JSON.parse(obj.result) }; } catch { /* fall through */ }
  }
  return { ok: false, code: 'LLM_BAD_OUTPUT', detail: stdout.slice(0, 2000) };
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

export class ClaudeCodeProvider implements LlmProvider {
  readonly id = 'claude-code' as const;
  private cachedAvailability: { value: Availability; at: number } | null = null;

  constructor(private readonly opts: ClaudeCodeProviderOptions) {}

  private command(): ClaudeCommand | null {
    return this.opts.command === undefined ? resolveClaudeCommand(this.opts.env) : this.opts.command;
  }

  private get logger(): Logger {
    return this.opts.logger ?? nullLogger;
  }

  async checkAvailable(options: { refresh?: boolean } = {}): Promise<Availability> {
    const c = this.cachedAvailability;
    if (!options.refresh && c && Date.now() - c.at < AVAILABILITY_TTL_MS) return c.value;
    const value = await this.probe();
    this.cachedAvailability = { value, at: Date.now() };
    return value;
  }

  private async probe(): Promise<Availability> {
    const cmd = this.command();
    if (!cmd) return { ok: false, reason: 'not-installed' };
    try {
      // Cheapest model: this call only proves the CLI runs and is signed in.
      const out = await this.runOnce(cmd, PROBE_TASK, new AbortController().signal, ['--model', 'haiku'], PROBE_TIMEOUT_MS);
      const parsed = parseClaudeOutput(out.stdout, out.stderr, out.exitCode);
      if (!parsed.ok) throw new AppError(parsed.code, parsed.detail);
      return { ok: true };
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError('UNKNOWN', String(err));
      this.logger.warn('claude_probe_failed', { code: e.code, detail: e.detailsForLog });
      if (e.code === 'CLAUDE_NOT_INSTALLED') return { ok: false, reason: 'not-installed', detail: e.detailsForLog };
      if (e.code === 'CLAUDE_NOT_LOGGED_IN') return { ok: false, reason: 'not-logged-in', detail: e.detailsForLog };
      return { ok: false, reason: 'error', detail: e.detailsForLog };
    }
  }

  async run<T>(task: LlmTask, signal: AbortSignal): Promise<T> {
    const cmd = this.command();
    if (!cmd) throw new AppError('CLAUDE_NOT_INSTALLED', 'claude executable not found');
    let lastError = new AppError('LLM_BAD_OUTPUT', 'no attempt made');
    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await this.runOnce(cmd, task, signal, [], this.opts.timeoutMs());
      const parsed = parseClaudeOutput(out.stdout, out.stderr, out.exitCode);
      if (!parsed.ok) {
        lastError = new AppError(parsed.code, parsed.detail);
        if (parsed.code !== 'LLM_BAD_OUTPUT') throw lastError;
      } else {
        const check = validateOutput(task.schema, parsed.value);
        if (check.ok) return parsed.value as T;
        lastError = new AppError('LLM_BAD_OUTPUT', check.errors);
      }
      this.logger.warn('llm_bad_output', { attempt, detail: lastError.detailsForLog });
    }
    throw lastError;
  }

  openLogin(): void {
    const cmd = this.command();
    if (!cmd) throw new AppError('CLAUDE_NOT_INSTALLED', 'claude executable not found');
    // Detached console app on Windows = its own visible window where the user signs in.
    spawn(cmd.file, cmd.argsPrefix, { detached: true, stdio: 'ignore', windowsHide: false, env: this.opts.env ?? process.env })
      .on('error', (err) => this.logger.error('open_login_failed', { message: err.message }))
      .unref();
  }

  private runOnce(cmd: ClaudeCommand, task: LlmTask, signal: AbortSignal, extraArgs: string[], timeoutMs: number): Promise<RunOutput> {
    if (signal.aborted) return Promise.reject(new AppError('LLM_CANCELLED', 'aborted before start'));

    let cwd: string;
    try {
      fs.mkdirSync(this.opts.tmpRoot, { recursive: true });
      cwd = fs.mkdtempSync(path.join(this.opts.tmpRoot, 'run-'));
    } catch (err) {
      return Promise.reject(new AppError('DATA_WRITE_FAILED', err instanceof Error ? err.message : String(err)));
    }
    let inputs: string[];
    try {
      inputs = stageInputFiles(cwd, task.files ?? []);
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
        child = spawn(cmd.file, [...cmd.argsPrefix, ...buildClaudeArgs(task, extraArgs)], {
          cwd,
          env: this.opts.env ?? process.env,
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
        (this.opts.kill ?? killTree)(child, this.logger);
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
        }, this.opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
      };
      const onAbort = () => stop('cancelled');
      const timer = setTimeout(() => stop('timeout'), timeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });

      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { if (stderr.length < 65_536) stderr += chunk; });
      child.stdin.on('error', () => { /* the child may exit before reading stdin */ });
      child.stdin.end(promptWithInputs(task, inputs), 'utf8');

      child.on('error', (err: NodeJS.ErrnoException) =>
        finish(() => reject(new AppError(err.code === 'ENOENT' ? 'CLAUDE_NOT_INSTALLED' : 'LLM_FAILED', err.message))),
      );
      child.on('close', (exitCode) => {
        // Retry cleanup unconditionally: if the promise already settled via the grace timer, the
        // process has (by definition) only just now actually exited, so this is the first chance
        // the folder can actually be removed.
        cleanup();
        finish(() => {
          if (stopReason === 'timeout') reject(new AppError('LLM_TIMEOUT', `no answer within ${timeoutMs} ms`));
          else if (stopReason === 'cancelled') reject(new AppError('LLM_CANCELLED', 'cancelled by the user'));
          else resolve({ stdout, stderr, exitCode });
        });
      });
    });
  }
}
