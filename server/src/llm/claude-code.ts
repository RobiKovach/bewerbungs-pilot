import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError, type ErrorCode } from '../errors.js';
import { nullLogger, type Logger } from '../log.js';
import { composePrompt } from '../prompts/languages.js';
import { AvailabilityCache, INPUT_DIR, killTree, runCli, stageInputFiles, type CliCommand, type RunOutput } from './cli-runner.js';
import type { Availability, LlmProvider, LlmTask } from './types.js';
import { validateOutput } from './validate.js';

export type ClaudeCommand = CliCommand;
export { killTree, stageInputFiles, INPUT_DIR };

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
const AUTH_ERROR_RE = /not logged in|\/login|invalid api key|unauthori[sz]ed/i;
const PROBE_TIMEOUT_MS = 60_000;
const PROBE_TASK: LlmTask = {
  id: 'probe',
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
    if (AUTH_ERROR_RE.test(all)) return { ok: false, code: 'LLM_NOT_LOGGED_IN', detail: all.slice(0, 2000) };
    return { ok: false, code: exitCode === 0 ? 'LLM_BAD_OUTPUT' : 'LLM_FAILED', detail: all.slice(0, 2000) };
  }
  if (obj.is_error === true || (obj.subtype !== undefined && obj.subtype !== 'success')) {
    const msg = String(obj.result ?? obj.subtype ?? 'error');
    return { ok: false, code: AUTH_ERROR_RE.test(msg) ? 'LLM_NOT_LOGGED_IN' : 'LLM_FAILED', detail: msg.slice(0, 2000) };
  }
  if (obj.structured_output !== undefined) return { ok: true, value: obj.structured_output };
  if (typeof obj.result === 'string') {
    try { return { ok: true, value: JSON.parse(obj.result) }; } catch { /* fall through */ }
  }
  return { ok: false, code: 'LLM_BAD_OUTPUT', detail: stdout.slice(0, 2000) };
}

export class ClaudeCodeProvider implements LlmProvider {
  readonly id = 'claude' as const;
  readonly readsFiles = true;
  private readonly cache = new AvailabilityCache();

  constructor(private readonly opts: ClaudeCodeProviderOptions) {}

  private command(): ClaudeCommand | null {
    return this.opts.command === undefined ? resolveClaudeCommand(this.opts.env) : this.opts.command;
  }

  private get logger(): Logger {
    return this.opts.logger ?? nullLogger;
  }

  async checkAvailable(options: { refresh?: boolean } = {}): Promise<Availability> {
    return this.cache.get(options.refresh === true, () => this.probe());
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
      if (e.code === 'LLM_NOT_INSTALLED') return { ok: false, reason: 'not-installed', detail: e.detailsForLog };
      if (e.code === 'LLM_NOT_LOGGED_IN') return { ok: false, reason: 'not-logged-in', detail: e.detailsForLog };
      return { ok: false, reason: 'error', detail: e.detailsForLog };
    }
  }

  async run<T>(task: LlmTask, signal: AbortSignal): Promise<T> {
    const cmd = this.command();
    if (!cmd) throw new AppError('LLM_NOT_INSTALLED', 'claude executable not found');
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
    if (!cmd) throw new AppError('LLM_NOT_INSTALLED', 'claude executable not found');
    // Detached console app on Windows = its own visible window where the user signs in.
    spawn(cmd.file, cmd.argsPrefix, { detached: true, stdio: 'ignore', windowsHide: false, env: this.opts.env ?? process.env })
      .on('error', (err) => this.logger.error('open_login_failed', { message: err.message }))
      .unref();
  }

  private runOnce(cmd: CliCommand, task: LlmTask, signal: AbortSignal, extraArgs: string[], timeoutMs: number): Promise<RunOutput> {
    return runCli({
      command: cmd, args: buildClaudeArgs(task, extraArgs), stdin: (inputs) => promptWithInputs(task, inputs),
      files: task.files, tmpRoot: this.opts.tmpRoot, timeoutMs, signal, env: this.opts.env, logger: this.logger,
      killGraceMs: this.opts.killGraceMs, kill: this.opts.kill,
    });
  }
}
