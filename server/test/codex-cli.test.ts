import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../src/log.js';
import { CODEX_DISABLED_FEATURES, CODEX_VERIFIED_VERSION, CodexCliProvider, buildCodexArgs, parseCodexOutput, resolveCodexCommand } from '../src/llm/codex-cli.js';
import { helloTask } from '../src/prompts/hello.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cx-'));
const signal = () => new AbortController().signal;
function provider(mode: string, extraEnv: Record<string, string> = {}, logger?: Logger) {
  return new CodexCliProvider({
    logger,
    tmpRoot: path.join(tmp(), 'tmp'), timeoutMs: () => 10_000,
    command: { file: process.execPath, argsPrefix: [FAKE] },
    env: { ...process.env, FAKE_CODEX_MODE: mode, ...extraEnv },
  });
}
const line = (e: unknown) => JSON.stringify(e);
const msg = (text: string) => line({ type: 'item.completed', item: { type: 'agent_message', text } });
const failed = (message: string) => line({ type: 'turn.failed', error: { message } });

describe('buildCodexArgs', () => {
  it('runs exec isolated: no user config, read-only, schema, no web/MCP/AGENTS.md, every risky feature off, prompt on stdin', () => {
    const args = buildCodexArgs('C:\\run\\schema.json');
    expect(args[0]).toBe('exec');
    for (const flag of ['--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--json']) expect(args).toContain(flag);
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args[args.indexOf('--output-schema') + 1]).toBe('C:\\run\\schema.json');
    expect(args).toEqual(expect.arrayContaining(['-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '-c', 'mcp_servers={}']));
    const disabled = args.flatMap((a, i) => (a === '--disable' ? [args[i + 1]] : []));
    expect(disabled).toEqual([...CODEX_DISABLED_FEATURES]);
    expect(disabled).toEqual(expect.arrayContaining(['shell_tool', 'unified_exec', 'plugins', 'hooks', 'browser_use', 'computer_use']));
    expect(args.at(-1)).toBe('-');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });
});

describe('parseCodexOutput', () => {
  it('takes the last agent message as the JSON answer', () => {
    expect(parseCodexOutput([msg('{"a":0}'), msg('{"a":1}'), line({ type: 'turn.completed' })].join('\n'), '', 0)).toEqual({ ok: true, value: { a: 1 } });
  });
  it('no agent message / not JSON / a JSON array / empty text -> bad output', () => {
    expect(parseCodexOutput(line({ type: 'turn.completed' }), '', 0)).toMatchObject({ ok: false, code: 'LLM_BAD_OUTPUT' });
    expect(parseCodexOutput('', '', 0)).toMatchObject({ ok: false, code: 'LLM_BAD_OUTPUT' });
    expect(parseCodexOutput(msg('Sorry, no.'), '', 0)).toMatchObject({ ok: false, code: 'LLM_BAD_OUTPUT' });
    expect(parseCodexOutput(msg('[1,2]'), '', 0)).toMatchObject({ ok: false, code: 'LLM_BAD_OUTPUT' });
    expect(parseCodexOutput(msg('null'), '', 0)).toMatchObject({ ok: false, code: 'LLM_BAD_OUTPUT' });
    expect(parseCodexOutput(msg(''), '', 0)).toMatchObject({ ok: false, code: 'LLM_BAD_OUTPUT' });
  });
  it('limit wins over auth words', () => {
    expect(parseCodexOutput(failed("You've hit your usage limit (429). Log in again later."), '', 1)).toMatchObject({ ok: false, code: 'LLM_LIMIT' });
  });
  it('every limit wording found in the codex binary is LLM_LIMIT, including the snake_case error ids', () => {
    for (const m of [
      "You've hit your usage limit.",
      'usage_limit_reached',
      'rate_limit_exceeded',
      'quota_exceeded',
      'Usage limit reached',
      'rate limit exceeded: try later',
      'Quota exceeded. Check your plan and billing details.',
    ]) expect(parseCodexOutput(failed(m), '', 1), m).toMatchObject({ ok: false, code: 'LLM_LIMIT' });
  });
  it('a plan without Codex ("upgrade to Plus" / usage_not_included) is not a limit', () => {
    expect(parseCodexOutput(failed('To use Codex with your ChatGPT plan, upgrade to Plus'), '', 1)).toMatchObject({ ok: false, code: 'LLM_FAILED' });
    expect(parseCodexOutput(failed('usage_not_included'), '', 1)).toMatchObject({ ok: false, code: 'LLM_FAILED' });
  });
  it('401 is not logged in', () => {
    const out = line({ type: 'error', message: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header' });
    expect(parseCodexOutput(out, '', 1)).toMatchObject({ ok: false, code: 'LLM_NOT_LOGGED_IN' });
  });
  it('anything else that failed is LLM_FAILED; garbage lines are ignored', () => {
    expect(parseCodexOutput(['not json', failed('stream disconnected')].join('\n'), '', 1)).toMatchObject({ ok: false, code: 'LLM_FAILED' });
  });
  it('a non-zero exit without any event: stderr decides, otherwise LLM_FAILED', () => {
    expect(parseCodexOutput('', 'boom', 1)).toMatchObject({ ok: false, code: 'LLM_FAILED' });
    expect(parseCodexOutput('', 'Error: Not logged in', 1)).toMatchObject({ ok: false, code: 'LLM_NOT_LOGGED_IN' });
  });
  it("a limit-like stderr line does not override the run's own generic failure events", () => {
    expect(parseCodexOutput(failed('stream disconnected before completion'), 'WARN retrying: rate limit exceeded (429)', 1)).toMatchObject({ ok: false, code: 'LLM_FAILED' });
    expect(parseCodexOutput(failed('stream disconnected'), 'Error: Not logged in', 1)).toMatchObject({ ok: false, code: 'LLM_FAILED' });
  });
  it('a retry notice before a completed turn does not spoil a good answer', () => {
    const out = [line({ type: 'error', message: 'Reconnecting... 1/5' }), msg('{"a":1}'), line({ type: 'turn.completed' })].join('\n');
    expect(parseCodexOutput(out, '', 0)).toEqual({ ok: true, value: { a: 1 } });
  });
  it('a completed turn without an answer but with a limit error is LLM_LIMIT, not bad output', () => {
    const out = [line({ type: 'error', message: 'usage_limit_reached' }), line({ type: 'turn.completed' })].join('\n');
    expect(parseCodexOutput(out, '', 0)).toMatchObject({ ok: false, code: 'LLM_LIMIT' });
  });
});

describe('resolveCodexCommand', () => {
  it('runs the package entry with node, never the .cmd', () => {
    const npm = tmp();
    const pkg = path.join(npm, 'node_modules', '@openai', 'codex');
    fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ bin: { codex: 'bin/codex.js' } }));
    fs.writeFileSync(path.join(pkg, 'bin', 'codex.js'), '');
    fs.writeFileSync(path.join(npm, 'codex.cmd'), '');
    expect(resolveCodexCommand({ PATH: npm, APPDATA: tmp() })).toEqual({ file: process.execPath, argsPrefix: [path.join(pkg, 'bin', 'codex.js')] });
  });
  it('null when not installed', () => {
    expect(resolveCodexCommand({ PATH: tmp(), APPDATA: tmp() })).toBeNull();
  });
});

describe('CodexCliProvider', () => {
  it('has the ChatGPT id and never reads files', () => {
    const p = provider('ok');
    expect(p.id).toBe('chatgpt');
    expect(p.readsFiles).toBe(false);
  });
  it('sends the prompt via stdin and the task schema as a file; the schema file is removed afterwards', async () => {
    const rec = path.join(tmp(), 'rec.json');
    const p = provider('ok', { FAKE_CODEX_RECORD: rec });
    expect(await p.run(helloTask('en'), signal())).toEqual({ greeting: 'Hallo!' });
    const r = JSON.parse(fs.readFileSync(rec, 'utf8'));
    expect(r.stdin).toContain('Greet the user of the BewerbungsPilot');
    expect(r.args.at(-1)).toBe('-');
    expect(r.schema).toEqual(helloTask('en').schema);
    const schemaFile = r.args[r.args.indexOf('--output-schema') + 1];
    expect(fs.existsSync(schemaFile)).toBe(false);
  });
  it('retries once on a bad answer, then succeeds', async () => {
    const counter = path.join(tmp(), 'n');
    expect(await provider('bad-then-ok', { FAKE_CODEX_COUNTER: counter }).run(helloTask('en'), signal())).toEqual({ greeting: 'second try' });
    expect(fs.readFileSync(counter, 'utf8')).toBe('2');
  });
  it('gives up after the second bad answer (refusal sentence / no answer / empty object): exactly two tries, LLM_BAD_OUTPUT', async () => {
    for (const mode of ['always-bad', 'no-message', 'always-empty']) {
      const counter = path.join(tmp(), 'n');
      await expect(provider(mode, { FAKE_CODEX_COUNTER: counter }).run(helloTask('en'), signal()), mode).rejects.toMatchObject({ code: 'LLM_BAD_OUTPUT' });
      expect(fs.readFileSync(counter, 'utf8'), mode).toBe('2');
    }
  });
  it('limit: no retry', async () => {
    const counter = path.join(tmp(), 'n');
    await expect(provider('limit', { FAKE_CODEX_COUNTER: counter }).run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'LLM_LIMIT' });
    expect(fs.readFileSync(counter, 'utf8')).toBe('1');
  });
  it('not signed in: LLM_NOT_LOGGED_IN, no retry', async () => {
    const counter = path.join(tmp(), 'n');
    await expect(provider('not-logged-in', { FAKE_CODEX_COUNTER: counter }).run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'LLM_NOT_LOGGED_IN' });
    expect(fs.readFileSync(counter, 'utf8')).toBe('1');
  });
  it('a task with files is refused (ChatGPT never gets files)', async () => {
    await expect(provider('ok').run({ ...helloTask('en'), files: ['C:\\cv.pdf'] }, signal())).rejects.toMatchObject({ code: 'LLM_FAILED' });
  });
  it('not installed: run throws LLM_NOT_INSTALLED', async () => {
    const none = new CodexCliProvider({ tmpRoot: tmp(), timeoutMs: () => 5000, command: null });
    await expect(none.run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'LLM_NOT_INSTALLED' });
  });
  it('availability via `codex login status`: not-installed / not-logged-in / ok', async () => {
    const none = new CodexCliProvider({ tmpRoot: tmp(), timeoutMs: () => 5000, command: null });
    expect(await none.checkAvailable()).toEqual({ ok: false, reason: 'not-installed' });
    expect(await provider('not-logged-in').checkAvailable()).toMatchObject({ ok: false, reason: 'not-logged-in' });
    expect(await provider('ok').checkAvailable()).toEqual({ ok: true });
  });
  it('the probe reads --version: the verified one logs nothing, another one only logs a warning', async () => {
    const warnings = (): { list: Array<[string, Record<string, unknown> | undefined]>; logger: Logger } => {
      const list: Array<[string, Record<string, unknown> | undefined]> = [];
      return { list, logger: { info() {}, error() {}, warn: (e, d) => list.push([e, d]) } };
    };
    const same = warnings();
    expect(await provider('ok', {}, same.logger).checkAvailable()).toEqual({ ok: true });
    expect(same.list.filter(([e]) => e.startsWith('codex_version'))).toEqual([]);
    const other = warnings();
    expect(await provider('ok', { FAKE_CODEX_VERSION: '0.170.0' }, other.logger).checkAvailable()).toEqual({ ok: true });
    expect(other.list).toContainEqual(['codex_version_untested', expect.objectContaining({ found: '0.170.0', verified: CODEX_VERIFIED_VERSION })]);
    const signedOut = warnings();
    expect(await provider('not-logged-in', { FAKE_CODEX_VERSION: '0.150.0' }, signedOut.logger).checkAvailable()).toMatchObject({ ok: false, reason: 'not-logged-in' });
    expect(signedOut.list.map(([e]) => e)).toContain('codex_version_untested');
  });
});
