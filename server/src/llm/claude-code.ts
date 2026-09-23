import { spawn, type ChildProcess } from 'node:child_process';
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
}

interface RunOutput { stdout: string; stderr: string; exitCode: number | null }

const DISALLOWED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'Task'];
const AUTH_ERROR_RE = /not logged in|\/login|invalid api key|unauthori[sz]ed/i;
const AVAILABILITY_TTL_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 60_000;
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
  return found ? { file: found, argsPrefix: [] } : null;
}

export function buildClaudeArgs(task: LlmTask, extra: string[] = []): string[] {
  const allowed = ['Read', ...(task.allowWebSearch ? ['WebSearch'] : [])];
  const args = [
    '-p', '--output-format', 'json', '--json-schema', JSON.stringify(task.schema),
    '--permission-mode', 'dontAsk', ...extra,
    '--allowedTools', ...allowed,
    '--disallowedTools', ...DISALLOWED_TOOLS,
  ];
  const dirs = [...new Set((task.files ?? []).map((f) => path.dirname(path.resolve(f))))];
  for (const dir of dirs) args.push('--add-dir', dir);
  return args;
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
export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
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
    fs.mkdirSync(this.opts.tmpRoot, { recursive: true });
    const cwd = fs.mkdtempSync(path.join(this.opts.tmpRoot, 'run-'));

    return new Promise<RunOutput>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let stopReason: 'timeout' | 'cancelled' | null = null;
      let settled = false;

      const child = spawn(cmd.file, [...cmd.argsPrefix, ...buildClaudeArgs(task, extraArgs)], {
        cwd,
        env: this.opts.env ?? process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stop = (reason: 'timeout' | 'cancelled') => {
        if (stopReason) return;
        stopReason = reason;
        killTree(child);
      };
      const onAbort = () => stop('cancelled');
      const timer = setTimeout(() => stop('timeout'), timeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
        fn();
      };

      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { if (stderr.length < 65_536) stderr += chunk; });
      child.stdin.on('error', () => { /* the child may exit before reading stdin */ });
      child.stdin.end(composePrompt(task), 'utf8');

      child.on('error', (err: NodeJS.ErrnoException) =>
        finish(() => reject(new AppError(err.code === 'ENOENT' ? 'CLAUDE_NOT_INSTALLED' : 'LLM_FAILED', err.message))),
      );
      child.on('close', (exitCode) =>
        finish(() => {
          if (stopReason === 'timeout') reject(new AppError('LLM_TIMEOUT', `no answer within ${timeoutMs} ms`));
          else if (stopReason === 'cancelled') reject(new AppError('LLM_CANCELLED', 'cancelled by the user'));
          else resolve({ stdout, stderr, exitCode });
        }),
      );
    });
  }
}
