import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeProvider, buildClaudeArgs, resolveClaudeCommand, parseClaudeOutput } from '../src/llm/claude-code.js';
import { helloTask } from '../src/prompts/hello.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cc-'));

function provider(mode: string, extraEnv: Record<string, string> = {}, timeoutMs = 10_000) {
  const tmpRoot = path.join(tmp(), 'tmp');
  const p = new ClaudeCodeProvider({
    tmpRoot,
    timeoutMs: () => timeoutMs,
    command: { file: process.execPath, argsPrefix: [FAKE] },
    env: { ...process.env, FAKE_CLAUDE_MODE: mode, ...extraEnv },
  });
  return { p, tmpRoot };
}
const signal = () => new AbortController().signal;

describe('buildClaudeArgs', () => {
  it('uses JSON output, the schema, dontAsk and a minimal tool list', () => {
    const args = buildClaudeArgs(helloTask('en'));
    expect(args.slice(0, 5)).toEqual(['-p', '--output-format', 'json', '--json-schema', JSON.stringify(helloTask('en').schema)]);
    expect(args).toContain('dontAsk');
    const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
    expect(allowed).toEqual(['Read']);
    expect(args).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'Task']));
  });
  it('adds WebSearch and file folders only when asked', () => {
    const args = buildClaudeArgs({ ...helloTask('en'), allowWebSearch: true, files: ['C:\\data\\cv.pdf', 'C:\\data\\x.txt'] });
    expect(args).toContain('WebSearch');
    expect(args.filter((a) => a === '--add-dir')).toHaveLength(1);
    expect(args[args.indexOf('--add-dir') + 1]).toBe(path.resolve('C:\\data'));
  });
});

describe('parseClaudeOutput', () => {
  it('prefers structured_output', () => {
    expect(parseClaudeOutput('{"type":"result","subtype":"success","is_error":false,"structured_output":{"a":1}}', '', 0)).toEqual({ ok: true, value: { a: 1 } });
  });
  it('treats an auth message as not logged in', () => {
    expect(parseClaudeOutput('', 'Invalid API key · Please run /login', 1)).toMatchObject({ ok: false, code: 'CLAUDE_NOT_LOGGED_IN' });
  });
});

describe('ClaudeCodeProvider.run', () => {
  it('returns the structured answer and passes the prompt via stdin', async () => {
    const record = path.join(tmp(), 'rec.json');
    const { p, tmpRoot } = provider('ok', { FAKE_CLAUDE_RECORD: record });
    await expect(p.run(helloTask('de'), signal())).resolves.toEqual({ greeting: 'Hallo!' });
    const rec = JSON.parse(fs.readFileSync(record, 'utf8'));
    expect(rec.stdin).toContain('Greet the user');
    expect(rec.stdin).toContain('in German.');
    expect(rec.args).not.toContain(rec.stdin);
    expect(path.resolve(rec.cwd).startsWith(path.resolve(tmpRoot))).toBe(true);
    expect(fs.readdirSync(tmpRoot)).toEqual([]); // run folder cleaned up
  });
  it('falls back to parsing the result string', async () => {
    await expect(provider('result-only').p.run(helloTask('en'), signal())).resolves.toEqual({ greeting: 'Hi' });
  });
  it('retries once when the answer does not match the schema', async () => {
    const counter = path.join(tmp(), 'n');
    await expect(provider('bad-then-ok', { FAKE_CLAUDE_COUNTER: counter }).p.run(helloTask('en'), signal())).resolves.toEqual({ greeting: 'second try' });
    expect(fs.readFileSync(counter, 'utf8')).toBe('2');
  });
  it('gives up with LLM_BAD_OUTPUT after the retry', async () => {
    await expect(provider('always-bad').p.run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'LLM_BAD_OUTPUT' });
  });
  it('reports garbage output as LLM_BAD_OUTPUT', async () => {
    await expect(provider('not-json').p.run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'LLM_BAD_OUTPUT' });
  });
  it('reports a signed-out CLI without retrying', async () => {
    const counter = path.join(tmp(), 'n');
    await expect(provider('not-logged-in', { FAKE_CLAUDE_COUNTER: counter }).p.run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'CLAUDE_NOT_LOGGED_IN' });
    expect(fs.readFileSync(counter, 'utf8')).toBe('1');
  });
  it('reports a crash as LLM_FAILED', async () => {
    await expect(provider('crash').p.run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'LLM_FAILED' });
  });
  it('kills a hanging process on timeout', async () => {
    const started = Date.now();
    await expect(provider('hang', {}, 400).p.run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(5000);
  });
  it('kills the process when the user cancels', async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 300);
    await expect(provider('hang').p.run(helloTask('en'), ctrl.signal)).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
  });
  it('reports a missing CLI as CLAUDE_NOT_INSTALLED', async () => {
    const p = new ClaudeCodeProvider({ tmpRoot: tmp(), timeoutMs: () => 1000, command: null });
    await expect(p.run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'CLAUDE_NOT_INSTALLED' });
  });
});

describe('ClaudeCodeProvider.checkAvailable', () => {
  it('is ok when the probe succeeds and caches the result', async () => {
    const counter = path.join(tmp(), 'n');
    const { p } = provider('ok', { FAKE_CLAUDE_COUNTER: counter });
    await expect(p.checkAvailable()).resolves.toEqual({ ok: true });
    await p.checkAvailable();
    expect(fs.readFileSync(counter, 'utf8')).toBe('1');
    await p.checkAvailable({ refresh: true });
    expect(fs.readFileSync(counter, 'utf8')).toBe('2');
  });
  it('detects a signed-out CLI', async () => {
    await expect(provider('not-logged-in').p.checkAvailable()).resolves.toMatchObject({ ok: false, reason: 'not-logged-in' });
  });
  it('detects a missing CLI', async () => {
    const p = new ClaudeCodeProvider({ tmpRoot: tmp(), timeoutMs: () => 1000, command: null });
    await expect(p.checkAvailable()).resolves.toMatchObject({ ok: false, reason: 'not-installed' });
  });
});

describe.runIf(process.platform === 'win32')('resolveClaudeCommand (Windows)', () => {
  it('finds claude.exe on PATH', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'claude.exe'), '');
    expect(resolveClaudeCommand({ PATH: dir, USERPROFILE: tmp() })).toEqual({ file: path.join(dir, 'claude.exe'), argsPrefix: [] });
  });
  it('follows an npm claude.cmd to the bundled exe', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'claude.cmd'), '');
    const exeDir = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
    fs.mkdirSync(exeDir, { recursive: true });
    fs.writeFileSync(path.join(exeDir, 'claude.exe'), '');
    expect(resolveClaudeCommand({ PATH: dir, USERPROFILE: tmp() })?.file).toBe(path.join(exeDir, 'claude.exe'));
  });
  it('falls back to %USERPROFILE%\\.local\\bin', () => {
    const home = tmp();
    fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, '.local', 'bin', 'claude.exe'), '');
    expect(resolveClaudeCommand({ PATH: tmp(), USERPROFILE: home })?.file).toBe(path.join(home, '.local', 'bin', 'claude.exe'));
  });
  it('returns null when nothing is installed', () => {
    expect(resolveClaudeCommand({ PATH: tmp(), USERPROFILE: tmp() })).toBeNull();
  });
});
