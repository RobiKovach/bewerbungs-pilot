import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { writeJsonAtomic } from './data/atomic.js';
import { dataPaths, ensureDataDirs, resolveDataRoot } from './data/paths.js';
import { SettingsStore } from './data/settings.js';
import { ClaudeCodeProvider } from './llm/claude-code.js';
import { FakeProvider } from './llm/fake.js';
import { LlmQueue } from './llm/queue.js';
import type { LlmProvider } from './llm/types.js';
import { createFileLogger } from './log.js';
import { openBrowser } from './runtime/browser.js';
import { findRunningInstance, type ServerInfo } from './runtime/instance.js';
import { findFreePort } from './runtime/port.js';

const HOST = '127.0.0.1';
const noOpen = process.argv.includes('--no-open') || process.env.BP_NO_OPEN === '1';
const fakeLlm = process.argv.includes('--fake-llm') || process.env.BP_FAKE_LLM === '1';

async function main(): Promise<void> {
  const paths = dataPaths(resolveDataRoot());
  ensureDataDirs(paths);
  const logger = createFileLogger(paths.logs);

  const running = await findRunningInstance(paths.server);
  if (running !== null) {
    if (!noOpen) openBrowser(`http://${HOST}:${running}/`);
    logger.info('already_running', { port: running });
    return;
  }

  const settings = new SettingsStore(paths.settings, (event, data) => logger.warn(event, data));
  settings.load();
  const provider: LlmProvider = fakeLlm
    ? new FakeProvider()
    : new ClaudeCodeProvider({ tmpRoot: paths.tmp, timeoutMs: () => settings.get().llm.timeoutSec * 1000, logger });
  const version = (JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));

  const port = await findFreePort(HOST, 4280, 4299);
  const app = await buildApp({
    settings, provider, queue: new LlmQueue(provider), logger, version,
    webDist: fs.existsSync(webDist) ? webDist : null,
    allowedHosts: () => [`${HOST}:${port}`, `localhost:${port}`],
    onShutdown: () => void shutdown(),
  });

  async function shutdown(): Promise<void> {
    logger.info('shutdown', {});
    await app.close().catch(() => {});
    fs.rmSync(paths.server, { force: true });
    process.exit(0);
  }

  await app.listen({ host: HOST, port });
  const info: ServerInfo = { port, pid: process.pid, startedAt: new Date().toISOString() };
  writeJsonAtomic(paths.server, info);
  logger.info('started', { port, version, fakeLlm });
  if (!noOpen) openBrowser(`http://${HOST}:${port}/`);
}

main().catch((err: unknown) => {
  const paths = dataPaths(resolveDataRoot());
  createFileLogger(paths.logs).error('fatal', { message: String(err), stack: (err as Error)?.stack });
  process.exit(1);
});
