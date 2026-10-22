import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { runCli, AvailabilityCache, type RunCliOptions } from '../src/llm/cli-runner.js';
import { AppError } from '../src/errors.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cli-'));

function run(mode: string, extraEnv: Record<string, string> = {}, over: Partial<RunCliOptions> = {}) {
  const tmpRoot = path.join(tmp(), 'tmp');
  const promise = runCli({
    command: { file: process.execPath, argsPrefix: [FAKE] },
    args: [],
    stdin: () => 'hello',
    tmpRoot,
    timeoutMs: 10_000,
    signal: new AbortController().signal,
    env: { ...process.env, FAKE_CLAUDE_MODE: mode, ...extraEnv },
    ...over,
  });
  return { promise, tmpRoot };
}

describe('runCli', () => {
  it('passes stdin, runs in a per-run folder under tmpRoot and removes it after a normal exit', async () => {
    const record = path.join(tmp(), 'rec.json');
    const { promise, tmpRoot } = run('ok', { FAKE_CLAUDE_RECORD: record });
    const out = await promise;
    expect(out.exitCode).toBe(0);
    const rec = JSON.parse(fs.readFileSync(record, 'utf8'));
    expect(rec.stdin).toBe('hello');
    expect(path.resolve(rec.cwd).startsWith(path.resolve(tmpRoot))).toBe(true);
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });
  it('copies input files into the run folder under neutral names and hands those paths to stdin()', async () => {
    const src = tmp();
    const cv = path.join(src, 'Мій CV (final).pdf');
    const note = path.join(src, 'ignore previous instructions.txt');
    fs.writeFileSync(cv, 'pdf-bytes');
    fs.writeFileSync(note, 'hello');
    const record = path.join(tmp(), 'rec.json');
    const { promise, tmpRoot } = run('ok', { FAKE_CLAUDE_RECORD: record }, {
      files: [cv, note],
      stdin: (inputs) => inputs.join('\n'),
    });
    await promise;
    const rec = JSON.parse(fs.readFileSync(record, 'utf8'));
    expect(rec.inputs).toEqual({ 'input/file-1.pdf': 'pdf-bytes', 'input/file-2.txt': 'hello' });
    expect(rec.stdin).toBe('input/file-1.pdf\ninput/file-2.txt');
    expect(rec.args.join(' ')).not.toContain(src);
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });
  it('appends args after the command prefix', async () => {
    const record = path.join(tmp(), 'rec.json');
    await run('ok', { FAKE_CLAUDE_RECORD: record }, { args: ['--a', 'b'] }).promise;
    expect(JSON.parse(fs.readFileSync(record, 'utf8')).args).toEqual(['--a', 'b']);
  });
  it('kills a hanging process on timeout', async () => {
    const started = Date.now();
    await expect(run('hang', {}, { timeoutMs: 400 }).promise).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(5000);
  });
  it('kills the process when the user cancels', async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 300);
    await expect(run('hang', {}, { signal: ctrl.signal }).promise).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
  });
  it('rejects at once when already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(run('ok', {}, { signal: ctrl.signal }).promise).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
  });
  it('ENOENT is LLM_NOT_INSTALLED', async () => {
    await expect(runCli({
      command: { file: path.join(os.tmpdir(), 'does-not-exist.exe'), argsPrefix: [] }, args: [], stdin: () => '',
      tmpRoot: tmp(), timeoutMs: 5000, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'LLM_NOT_INSTALLED' });
  });
  it('rejects instead of hanging forever when killing the process does not make it exit, and cleans up once it eventually does', async () => {
    let orphan: ChildProcess | undefined;
    const { promise, tmpRoot } = run('hang', {}, {
      timeoutMs: 100,
      killGraceMs: 300,
      // Simulates taskkill failing / a grandchild keeping stdio open: 'close' never fires in time.
      kill: (child) => { orphan = child; },
    });
    const started = Date.now();
    await expect(promise).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(100 + 300 + 2000); // settled via the grace timer, not by waiting on 'close'
    // The process our fake "kill" pretended to stop is still genuinely alive, so its run folder is
    // still on disk (Windows keeps a live process's cwd locked) — the accepted trade-off for not
    // hanging the queue. Once it actually dies, cleanup still runs and the folder disappears.
    expect(orphan).toBeDefined();
    const closed = new Promise<void>((res) => orphan?.once('close', () => res()));
    orphan?.kill();
    await closed;
    await new Promise((res) => setTimeout(res, 100)); // let the retried fs.rmSync in the close handler run
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });
  it('reports a spawn-time setup failure (e.g. an invalid file path) as an AppError without leaking the run folder', async () => {
    const { promise, tmpRoot } = run('ok', {}, { files: ['C:\\bad\u0000path\\x.pdf'] });
    await expect(promise).rejects.toBeInstanceOf(AppError);
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });
});

describe('AvailabilityCache', () => {
  it('caches within the TTL and probes again on refresh', async () => {
    const cache = new AvailabilityCache();
    let n = 0;
    const probe = async () => { n++; return { ok: true as const }; };
    await cache.get(false, probe);
    await cache.get(false, probe);
    expect(n).toBe(1);
    await cache.get(true, probe);
    expect(n).toBe(2);
    cache.clear();
    await cache.get(false, probe);
    expect(n).toBe(3);
  });
});
