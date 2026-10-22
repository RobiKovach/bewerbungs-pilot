import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError, type ErrorCode } from '../errors.js';
import { nullLogger, type Logger } from '../log.js';
import { composePrompt } from '../prompts/languages.js';
import { AvailabilityCache, runCli, type CliCommand } from './cli-runner.js';
import type { Availability, JsonSchema, LlmProvider, LlmTask } from './types.js';
import { validateOutput } from './validate.js';

// Isolation (spec §3, proven in the spike and re-checked on Codex CLI 0.162.1): no shell/file/web/browser tools,
// no plugins/hooks/MCP, no AGENTS.md, none of the person's config.toml or exec-policy rules, no session files.
// Sign-in still comes from CODEX_HOME.
export const CODEX_DISABLED_FEATURES = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'multi_agent', 'browser_use',
  'browser_use_external', 'computer_use', 'image_generation', 'view_image', 'skill_search', 'tool_suggest', 'goals',
  'in_app_browser', 'remote_plugin', 'workspace_dependencies'] as const;
// Wordings found in the codex binary (journal "Task 1 facts"): "You've hit your usage limit.", "Usage limit reached",
// "rate limit exceeded: ", "Quota exceeded. …", and the error-kind ids usage_limit_reached / rate_limit_exceeded /
// quota_exceeded. "[ _]" catches the snake_case ids. NOT a limit: usage_not_included ("… upgrade to Plus") —
// a plan without Codex stays a generic failure.
const CODEX_LIMIT_RE = /usage[ _]limit|rate[ _]limit|quota|too many requests|\b429\b/i;
const CODEX_AUTH_RE = /\b401\b|unauthori[sz]ed|not logged in|authentication/i;
const STATUS_TIMEOUT_MS = 15_000;
/** The one Codex CLI version the isolation flags above were verified on (`npm run check:codex`). The install table
 *  pins it; the availability probe logs a warning when the person runs a different one. */
export const CODEX_VERIFIED_VERSION = '0.162.1';

export interface CodexCliProviderOptions {
  /** Parent of the per-run working folders (and of the short-lived schema files). */
  tmpRoot: string;
  timeoutMs: () => number;
  /** undefined = auto-detect with resolveCodexCommand(); null = "not installed". */
  command?: CliCommand | null;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
}

type Parsed = { ok: true; value: unknown } | { ok: false; code: ErrorCode; detail: string };

const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** npm puts codex.cmd next to node_modules; we run the package's own entry file with node — no shell, no .cmd. */
/** Folders searched for the npm-installed package: PATH entries that hold a codex shim, then %APPDATA%\npm. */
export function codexSearchRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const roots = dirs.filter((d) => isFile(path.join(d, 'codex.cmd')) || isFile(path.join(d, 'codex')));
  if (env.APPDATA) roots.push(path.join(env.APPDATA, 'npm'));
  return roots;
}

export function resolveCodexCommand(env: NodeJS.ProcessEnv = process.env): CliCommand | null {
  for (const root of codexSearchRoots(env)) {
    const pkgDir = path.resolve(root, 'node_modules', '@openai', 'codex');
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> };
      const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.codex;
      if (!bin) continue;
      const entry = path.resolve(pkgDir, bin);
      if (isFile(entry)) return { file: process.execPath, argsPrefix: [entry] };
    } catch { /* not here */ }
  }
  return null;
}

export function buildCodexArgs(schemaFile: string): string[] {
  return [
    'exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--sandbox', 'read-only', '--color', 'never', '--json', '--output-schema', schemaFile,
    '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '-c', 'mcp_servers={}',
    ...CODEX_DISABLED_FEATURES.flatMap((f) => ['--disable', f]),
    '-',
  ];
}

function classify(text: string, fallback: ErrorCode): ErrorCode {
  if (CODEX_LIMIT_RE.test(text)) return 'LLM_LIMIT';
  if (CODEX_AUTH_RE.test(text)) return 'LLM_NOT_LOGGED_IN';
  return fallback;
}

/**
 * `codex exec --json` prints JSONL events. The answer is the text of the LAST agent_message item (thanks to
 * --output-schema it is the JSON object as a string). A failed turn (or a non-zero exit without a completed turn)
 * is a failure classified by its messages; a completed turn without a usable JSON object is LLM_BAD_OUTPUT
 * (retried by the caller) — unless an error event of that run says limit / not signed in.
 */
export function parseCodexOutput(stdout: string, stderr: string, exitCode: number | null): Parsed {
  const events = stdout.split('\n').flatMap((l) => {
    try { const v: unknown = JSON.parse(l); return v && typeof v === 'object' && !Array.isArray(v) ? [v as Record<string, unknown>] : []; } catch { return []; }
  });
  const errors = events.flatMap((e) => {
    if (e.type === 'error' && typeof e.message === 'string') return [e.message];
    if (e.type === 'turn.failed') return [String((e.error as { message?: unknown } | undefined)?.message ?? 'turn failed')];
    return [];
  });
  const turnFailed = events.some((e) => e.type === 'turn.failed');
  const turnCompleted = events.some((e) => e.type === 'turn.completed');
  if (turnFailed || (exitCode !== 0 && !turnCompleted)) {
    const text = [...errors, stderr].join('\n').trim() || `codex exited with ${String(exitCode)}`;
    // Classify on the run's own error events; stderr (log noise, retries) decides only when there are none.
    const classifyOn = errors.length > 0 ? errors.join('\n') : stderr;
    return { ok: false, code: classify(classifyOn, 'LLM_FAILED'), detail: text.slice(0, 2000) };
  }
  const last = events.filter((e) => e.type === 'item.completed' && (e.item as { type?: unknown } | undefined)?.type === 'agent_message').at(-1);
  const raw = (last?.item as { text?: unknown } | undefined)?.text;
  const text = typeof raw === 'string' ? raw : '';
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v };
  } catch { /* below */ }
  const errorText = errors.join('\n');
  return { ok: false, code: classify(errorText, 'LLM_BAD_OUTPUT'), detail: (text || errorText || 'no agent message').slice(0, 2000) };
}

/**
 * OpenAI strict structured outputs (what Codex's --output-schema uses) need every object to have
 * additionalProperties: false and to list ALL its properties in `required`. One line per problem; [] = strict.
 * Walks only `properties` and `items`: objects inside `$defs`, `oneOf`, `allOf` or `anyOf` are not checked (task schemas
 * use these only for plain values, e.g. `anyOf: [string, null]`).
 */
export function strictProblems(schema: JsonSchema, at = '$'): string[] {
  const out: string[] = [];
  const type = schema.type;
  const props = schema.properties as Record<string, JsonSchema> | undefined;
  const isObject = type === 'object' || (Array.isArray(type) && type.includes('object')) || props !== undefined;
  if (isObject) {
    if (schema.additionalProperties !== false) out.push(`${at}: additionalProperties is not false`);
    const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
    for (const key of Object.keys(props ?? {})) if (!required.includes(key)) out.push(`${at}: "${key}" is not in required`);
  }
  for (const [key, sub] of Object.entries(props ?? {})) out.push(...strictProblems(sub, `${at}.${key}`));
  const items = schema.items;
  if (items && typeof items === 'object' && !Array.isArray(items)) out.push(...strictProblems(items as JsonSchema, `${at}[]`));
  if (Array.isArray(schema.anyOf)) (schema.anyOf as JsonSchema[]).forEach((s, i) => out.push(...strictProblems(s, `${at}.anyOf[${i}]`)));
  return out;
}

export class CodexCliProvider implements LlmProvider {
  readonly id = 'chatgpt' as const;
  readonly readsFiles = false;
  private readonly cache = new AvailabilityCache();

  constructor(private readonly opts: CodexCliProviderOptions) {}

  private get logger(): Logger { return this.opts.logger ?? nullLogger; }
  private command(): CliCommand | null { return this.opts.command === undefined ? resolveCodexCommand(this.opts.env) : this.opts.command; }

  checkAvailable(o: { refresh?: boolean } = {}): Promise<Availability> {
    return this.cache.get(o.refresh === true, () => this.probe());
  }

  /** `codex login status` — instant and costs no quota (the Settings "Check" button still sends a real request). */
  private async probe(): Promise<Availability> {
    const cmd = this.command();
    if (!cmd) return { ok: false, reason: 'not-installed' };
    // Both run side by side; the version only ever adds a log line, it never changes the availability.
    const [availability] = await Promise.all([this.loginStatus(cmd), this.checkVersion(cmd)]);
    return availability;
  }

  /** `codex --version` → a warning in the log when it is not the version the isolation flags were verified on. */
  private async checkVersion(cmd: CliCommand): Promise<void> {
    try {
      const out = await runCli({
        command: cmd, args: ['--version'], stdin: () => '', tmpRoot: this.opts.tmpRoot, timeoutMs: STATUS_TIMEOUT_MS,
        signal: new AbortController().signal, env: this.opts.env, logger: this.logger,
      });
      const found = /\d+\.\d+\.\d+(?:[-+][\w.-]+)?/.exec(`${out.stdout}\n${out.stderr}`)?.[0] ?? null;
      if (found !== CODEX_VERIFIED_VERSION) {
        this.logger.warn('codex_version_untested', { found, verified: CODEX_VERIFIED_VERSION, output: `${out.stdout}${out.stderr}`.trim().slice(0, 200) });
      }
    } catch (err) {
      this.logger.warn('codex_version_unknown', { verified: CODEX_VERIFIED_VERSION, detail: err instanceof AppError ? err.detailsForLog : String(err) });
    }
  }

  private async loginStatus(cmd: CliCommand): Promise<Availability> {
    try {
      const out = await runCli({
        command: cmd, args: ['login', 'status'], stdin: () => '', tmpRoot: this.opts.tmpRoot, timeoutMs: STATUS_TIMEOUT_MS,
        signal: new AbortController().signal, env: this.opts.env, logger: this.logger,
      });
      const text = `${out.stdout}\n${out.stderr}`;
      if (out.exitCode === 0 && /logged in/i.test(text) && !/not logged in/i.test(text)) return { ok: true };
      if (/not logged in/i.test(text)) return { ok: false, reason: 'not-logged-in' };
      return { ok: false, reason: 'error', detail: text.trim().slice(0, 2000) };
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError('UNKNOWN', String(err));
      this.logger.warn('codex_probe_failed', { code: e.code, detail: e.detailsForLog });
      if (e.code === 'LLM_NOT_INSTALLED') return { ok: false, reason: 'not-installed', detail: e.detailsForLog };
      return { ok: false, reason: 'error', detail: e.detailsForLog };
    }
  }

  async run<T>(task: LlmTask, signal: AbortSignal): Promise<T> {
    if (task.files?.length) throw new AppError('LLM_FAILED', 'bug: chatgpt never gets files');
    const cmd = this.command();
    if (!cmd) throw new AppError('LLM_NOT_INSTALLED', 'codex not found');
    let lastError = new AppError('LLM_BAD_OUTPUT', 'no attempt made');
    for (let attempt = 1; attempt <= 2; attempt++) {
      const parsed = await this.once(cmd, task, signal);
      if (!parsed.ok) {
        lastError = new AppError(parsed.code, parsed.detail);
        if (parsed.code !== 'LLM_BAD_OUTPUT') throw lastError;
      } else {
        const check = validateOutput(task.schema, parsed.value);
        if (check.ok) return parsed.value as T;
        lastError = new AppError('LLM_BAD_OUTPUT', check.errors);
      }
      this.logger.warn('llm_bad_output', { provider: 'chatgpt', attempt, detail: lastError.detailsForLog });
    }
    throw lastError;
  }

  openLogin(): void {
    const cmd = this.command();
    if (!cmd) throw new AppError('LLM_NOT_INSTALLED', 'codex not found');
    fs.mkdirSync(this.opts.tmpRoot, { recursive: true });
    // Detached console app = its own visible window; `codex login` opens the ChatGPT sign-in page in the browser.
    spawn(cmd.file, [...cmd.argsPrefix, 'login'], { cwd: this.opts.tmpRoot, detached: true, stdio: 'ignore', windowsHide: false, env: this.opts.env ?? process.env })
      .on('error', (err) => this.logger.error('open_login_failed', { message: err.message }))
      .unref();
  }

  private async once(cmd: CliCommand, task: LlmTask, signal: AbortSignal): Promise<Parsed> {
    // The schema file lives next to (not inside) the per-run folder and is removed right after the run.
    fs.mkdirSync(this.opts.tmpRoot, { recursive: true });
    const schemaFile = path.join(this.opts.tmpRoot, `schema-${crypto.randomUUID()}.json`);
    fs.writeFileSync(schemaFile, JSON.stringify(task.schema));
    try {
      const out = await runCli({
        command: cmd, args: buildCodexArgs(schemaFile), stdin: () => composePrompt(task),
        tmpRoot: this.opts.tmpRoot, timeoutMs: this.opts.timeoutMs(), signal, env: this.opts.env, logger: this.logger,
      });
      return parseCodexOutput(out.stdout, out.stderr, out.exitCode);
    } finally {
      fs.rmSync(schemaFile, { force: true });
    }
  }
}
