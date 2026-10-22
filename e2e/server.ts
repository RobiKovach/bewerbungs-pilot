import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const START_TIMEOUT_MS = 30_000;

/** Everything the spec needs to reach the copy of the app started for the run. */
export interface E2eEnv { url: string; port: number; key: string; dataDir: string; backupDir: string }

export interface Running extends E2eEnv { stop(): Promise<void> }

/**
 * Starts the built app on its own temporary data and backup folders, with scripted AI, mail written to files
 * and the update check pointed at a local copy of `version-newer.json`. Never touches the installed app:
 * a different data folder means a different server.json, and the server picks a free port itself.
 */
export async function startApp(): Promise<Running> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2e-'));
  const dataDir = path.join(base, 'data');
  const backupDir = path.join(base, 'backups');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const versionServer = await serveFile(path.join(FIXTURES, 'version-newer.json'));
  const versionUrl = `http://127.0.0.1:${(versionServer.address() as { port: number }).port}/version.json`;

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'dist', 'index.js'), '--fake-llm', '--fake-mail', '--no-open'], {
    cwd: ROOT,
    env: { ...process.env, BP_DATA_DIR: dataDir, BP_BACKUP_DIR: backupDir, BP_UPDATE_URL: versionUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output: string[] = [];
  child.stdout?.on('data', (b: Buffer) => output.push(b.toString()));
  child.stderr?.on('data', (b: Buffer) => output.push(b.toString()));

  const info = await waitForServerFile(path.join(dataDir, 'server.json'), child, output);
  const env: E2eEnv = { url: `http://127.0.0.1:${info.port}`, port: info.port, key: info.key, dataDir, backupDir };

  return {
    ...env,
    async stop() {
      await shutdown(env, child);
      await new Promise<void>((resolve) => versionServer.close(() => resolve()));
      fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

function serveFile(file: string): Promise<http.Server> {
  const body = fs.readFileSync(file);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function waitForServerFile(file: string, child: ChildProcess, output: string[]): Promise<{ port: number; key: string }> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`app exited with ${child.exitCode}:\n${output.join('')}`);
    try {
      const info = JSON.parse(fs.readFileSync(file, 'utf8')) as { port?: unknown; key?: unknown };
      if (typeof info.port === 'number' && typeof info.key === 'string') return { port: info.port, key: info.key };
    } catch { /* not written yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`app did not start within ${START_TIMEOUT_MS} ms:\n${output.join('')}`);
}

/** The app's own quit route (the one the "Quit" button uses); killed only if it does not exit in time. */
async function shutdown(env: E2eEnv, child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    await fetch(`${env.url}/api/shutdown`, { method: 'POST', headers: { 'x-bp-key': env.key, 'x-bp-client': '1' } });
  } catch { /* already gone */ }
  const timer = setTimeout(() => child.kill(), 10_000);
  await exited;
  clearTimeout(timer);
}
