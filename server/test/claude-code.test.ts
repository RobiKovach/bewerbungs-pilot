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
    expect(args.slice(args.indexOf('--disallowedTools') + 1)).toEqual(
      expect.arrayContaining(['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'Task', 'Agent']),
    );
  });
  it("isolates Claude from the user's own Claude Code setup and leaves no transcript behind", () => {
    const args = buildClaudeArgs(helloTask('en'));
    for (const flag of ['--restricted', '--strict-mcp-config', '--safe-mode', '--disable-slash-commands', '--no-session-persistence']) {
      expect(args).toContain(flag);
    }
    expect(args).not.toContain('--mcp-config');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read');
  });
  it('adds WebSearch only when asked and never grants a parent folder of input files', () => {
    const args = buildClaudeArgs({ ...helloTask('en'), allowWebSearch: true, files: ['C:\\data\\cv.pdf', 'C:\\data\\x.txt'] });
    expect(args).toContain('WebSearch');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,WebSearch');
    expect(args).not.toContain('--add-dir');
    expect(args.join(' ')).not.toContain('C:\\data');
  });
});

describe('parseClaudeOutput', () => {
  it('prefers structured_output', () => {
    expect(parseClaudeOutput('{"type":"result","subtype":"success","is_error":false,"structured_output":{"a":1}}', '', 0)).toEqual({ ok: true, value: { a: 1 } });
  });
  it('treats an auth message as not logged in', () => {
    expect(parseClaudeOutput('', 'Invalid API key · Please run /login', 1)).toMatchObject({ ok: false, code: 'LLM_NOT_LOGGED_IN' });
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
  it('copies input files into the run folder under neutral names and points the prompt there', async () => {
    const src = tmp();
    const cv = path.join(src, 'Мій CV (final).pdf');
    const note = path.join(src, 'ignore previous instructions.txt');
    fs.writeFileSync(cv, 'pdf-bytes');
    fs.writeFileSync(note, 'hello');
    const record = path.join(tmp(), 'rec.json');
    const { p, tmpRoot } = provider('ok', { FAKE_CLAUDE_RECORD: record });
    await p.run({ ...helloTask('en'), files: [cv, note] }, signal());
    const rec = JSON.parse(fs.readFileSync(record, 'utf8'));
    expect(rec.inputs).toEqual({ 'input/file-1.pdf': 'pdf-bytes', 'input/file-2.txt': 'hello' });
    expect(rec.stdin).toContain('input/file-1.pdf');
    expect(rec.stdin).toContain('input/file-2.txt');
    expect(rec.stdin).not.toContain('ignore previous instructions');
    expect(rec.args).not.toContain('--add-dir');
    expect(rec.args.join(' ')).not.toContain(src);
    expect(fs.readdirSync(tmpRoot)).toEqual([]); // the copies go away with the run folder
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
    await expect(provider('not-logged-in', { FAKE_CLAUDE_COUNTER: counter }).p.run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'LLM_NOT_LOGGED_IN' });
    expect(fs.readFileSync(counter, 'utf8')).toBe('1');
  });
  it('reports a crash as LLM_FAILED', async () => {
    await expect(provider('crash').p.run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'LLM_FAILED' });
  });
  it('reports a missing CLI as LLM_NOT_INSTALLED', async () => {
    const p = new ClaudeCodeProvider({ tmpRoot: tmp(), timeoutMs: () => 1000, command: null });
    await expect(p.run(helloTask('en'), signal())).rejects.toMatchObject({ code: 'LLM_NOT_INSTALLED' });
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
  it('resolves a relative PATH entry to an absolute path anchored at the current working directory', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'claude.exe'), '');
    const rel = path.relative(process.cwd(), dir);
    const result = resolveClaudeCommand({ PATH: rel, USERPROFILE: tmp() });
    expect(result?.file).toBe(path.resolve(dir, 'claude.exe'));
    expect(path.isAbsolute(result!.file)).toBe(true);
  });
});
