import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { INSTALL_COMMANDS, InstallJob } from '../src/llm/install.js';
import { CODEX_VERIFIED_VERSION } from '../src/llm/codex-cli.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-install.mjs', import.meta.url));
const cmds = (mode: string) => ({ claude: () => ({ file: process.execPath, args: [FAKE, mode] }), chatgpt: () => ({ file: process.execPath, args: [FAKE, mode] }) });
const settle = async (job: InstallJob) => { for (let i = 0; i < 200 && job.status().state === 'running'; i++) await new Promise((r) => setTimeout(r, 25)); return job.status(); };

describe('InstallJob', () => {
  it('runs and reports done; onDone gets the provider', async () => {
    const done: string[] = [];
    const job = new InstallJob({ commands: cmds('ok'), onDone: (id) => done.push(id) });
    expect(job.start('chatgpt')).toMatchObject({ state: 'running', provider: 'chatgpt' });
    expect(await settle(job)).toMatchObject({ state: 'done', provider: 'chatgpt' });
    expect(done).toEqual(['chatgpt']);
  });
  it('a failure keeps the technical line', async () => {
    const job = new InstallJob({ commands: cmds('fail') });
    job.start('chatgpt');
    expect(await settle(job)).toMatchObject({ state: 'failed', detail: expect.stringContaining('E404') });
  });
  it('a second start while running is CONFLICT', async () => {
    const job = new InstallJob({ commands: cmds('hang'), timeoutMs: 400 });
    job.start('chatgpt');
    expect(() => job.start('claude')).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    await settle(job);
  });
  it('a hang becomes failed after the timeout', async () => {
    const job = new InstallJob({ commands: cmds('hang'), timeoutMs: 300 });
    job.start('chatgpt');
    expect(await settle(job)).toMatchObject({ state: 'failed', detail: expect.stringMatching(/timeout/i) });
  });
  it('can start again after a finished install', async () => {
    const job = new InstallJob({ commands: cmds('fail') });
    job.start('chatgpt');
    await settle(job);
    expect(job.start('claude')).toMatchObject({ state: 'running', provider: 'claude' });
    await settle(job);
  });
  it('a synchronous spawn throw ends in failed, never forever running; a new install can start', async () => {
    const job = new InstallJob({ commands: { claude: () => ({ file: process.execPath, args: ['bad\0arg'] }), chatgpt: () => ({ file: process.execPath, args: ['bad\0arg'] }) }, timeoutMs: 200 });
    expect(job.start('chatgpt')).toMatchObject({ state: 'failed', provider: 'chatgpt' });
    expect(job.status().detail).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    expect(job.status().state).toBe('failed');
    expect(job.start('claude')).toMatchObject({ state: 'failed', provider: 'claude' });
  });
  it('the built-in table uses no shell and fixed arguments', () => {
    const g = INSTALL_COMMANDS.chatgpt();
    expect(g.file).toBe(process.execPath);
    expect(g.args.slice(1)).toEqual(['i', '-g', `@openai/codex@${CODEX_VERIFIED_VERSION}`]);
    expect(g.args.at(-1)).toBe('@openai/codex@0.162.1');
    expect(g.args[0]).toMatch(/npm-cli\.js$/);
    const c = INSTALL_COMMANDS.claude();
    expect(c.file.toLowerCase()).toMatch(/powershell\.exe$/);
    expect(c.args).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex']);
  });
});
