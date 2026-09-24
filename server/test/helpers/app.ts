import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../../src/app.js';
import { SettingsStore } from '../../src/data/settings.js';
import { FakeProvider } from '../../src/llm/fake.js';
import { LlmQueue } from '../../src/llm/queue.js';
import { nullLogger } from '../../src/log.js';
import { ProfileFiles } from '../../src/profile/files.js';
import { ProfileStore } from '../../src/profile/store.js';

export const H = { 'x-bp-client': '1' };

export async function makeApp(opts: { provider?: FakeProvider; webDist?: string | null; allowedHosts?: () => string[] } = {}) {
  // Spaces + Cyrillic on purpose: real user folders look like C:\Users\Ольга Коваль\.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp app Дані-'));
  const settings = new SettingsStore(path.join(dir, 'settings.json'));
  settings.load();
  const profileFile = path.join(dir, 'profile', 'profile.json');
  const filesDir = path.join(dir, 'profile', 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const profileStore = new ProfileStore(profileFile);
  profileStore.load();
  const profileFiles = new ProfileFiles(filesDir);
  const provider = opts.provider ?? new FakeProvider();
  let shutdownCalls = 0;
  const app = await buildApp({
    settings, provider, queue: new LlmQueue(provider), logger: nullLogger, version: '0.1.0',
    webDist: opts.webDist ?? null,
    allowedHosts: opts.allowedHosts ?? (() => ['localhost:80']),
    onShutdown: () => { shutdownCalls++; },
    profileStore, profileFiles,
  });
  return { app, provider, settings, profileStore, profileFiles, profileFile, filesDir, shutdownCalls: () => shutdownCalls };
}
