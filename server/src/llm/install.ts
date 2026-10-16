import { spawn } from 'node:child_process';
import path from 'node:path';
import type { InstallStatus, ProviderId } from '@bp/shared';
import { AppError } from '../errors.js';
import { nullLogger, type Logger } from '../log.js';
import { killTree } from './cli-runner.js';

export interface InstallCommand { file: string; args: string[] }

const npmCli = () => path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const powershell = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// Fixed commands only (spec §4): the request names a provider, never a package or a command.
export const INSTALL_COMMANDS: Readonly<Record<ProviderId, () => InstallCommand>> = {
  claude: () => ({ file: powershell(), args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'] }),
  chatgpt: () => ({ file: process.execPath, args: [npmCli(), 'i', '-g', '@openai/codex'] }),
};
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const TAIL = 2000;

export class InstallJob {
  private state: InstallStatus = { state: 'idle', provider: null };
  constructor(private readonly o: { commands?: Readonly<Record<ProviderId, () => InstallCommand>>; timeoutMs?: number; logger?: Logger; onDone?: (id: ProviderId) => void } = {}) {}

  status(): InstallStatus { return { ...this.state }; }

  start(id: ProviderId): InstallStatus {
    if (this.state.state === 'running') throw new AppError('CONFLICT', 'an install is already running');
    const logger = this.o.logger ?? nullLogger;
    const cmd = (this.o.commands ?? INSTALL_COMMANDS)[id]();
    this.state = { state: 'running', provider: id };
    let out = '';
    let finished = false;
    const timeoutMs = this.o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const finish = (next: InstallStatus) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); // declared below; finish only runs after it exists
      this.state = next;
      logger.info('ai_install', { provider: id, state: next.state });
      if (next.state === 'done') {
        try { this.o.onDone?.(id); } catch (err) { logger.warn('ai_install_ondone_failed', { message: (err as Error).message }); }
      }
    };
    const child = spawn(cmd.file, cmd.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (chunk: Buffer) => { out = (out + chunk.toString('utf8')).slice(-TAIL); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      killTree(child, logger);
      finish({ state: 'failed', provider: id, detail: `timeout after ${Math.round(timeoutMs / 1000)} s\n${out}`.trim() });
    }, timeoutMs);
    child.on('error', (err) => finish({ state: 'failed', provider: id, detail: err.message }));
    child.on('close', (code) => finish(code === 0 ? { state: 'done', provider: id } : { state: 'failed', provider: id, detail: `exit code ${code}\n${out}`.trim() }));
    return this.status();
  }
}
