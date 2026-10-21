import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { ApplicationJob } from '../../src/applications/job.js';
import { ApplicationStore } from '../../src/applications/store.js';
import { SentUnsavedLog } from '../../src/applications/sent-unsaved.js';
import { profilePhoto } from '../../src/applications/views.js';
import { buildApp } from '../../src/app.js';
import { dataPaths } from '../../src/data/paths.js';
import { SettingsStore } from '../../src/data/settings.js';
import { FakeProvider } from '../../src/llm/fake.js';
import { InstallJob } from '../../src/llm/install.js';
import { ProviderRegistry } from '../../src/llm/providers.js';
import { LlmQueue } from '../../src/llm/queue.js';
import type { ProviderId } from '../../src/llm/types.js';
import { nullLogger, type Logger } from '../../src/log.js';
import { MemorySecretStore } from '../../src/mail/secret.js';
import { ProfileFiles } from '../../src/profile/files.js';
import { ProfileStore } from '../../src/profile/store.js';
import { Activity } from '../../src/runtime/activity.js';
import { SearchJob } from '../../src/vacancies/search-job.js';
import { VacancyStore } from '../../src/vacancies/store.js';
import { FakePrinter } from './applications.js';
import { FakeGoogleAuth, FakeMailer } from './mail.js';
import { fakeSource, FakePageReader, type FakeSource } from './vacancies.js';

export const TEST_KEY = 'test-launch-key-0123456789abcdefghijklmnopq';
export const H = { 'x-bp-client': '1', 'x-bp-key': TEST_KEY };

/**
 * `autoKey` (default true): every `app.inject` carries the launch key unless the test sets its own `x-bp-key`
 * or cookie, so tests about other things need not repeat it. Launch-key tests pass `autoKey: false`.
 */
export async function makeApp(opts: { provider?: FakeProvider; chatgpt?: FakeProvider; chosen?: ProviderId | null; settingsFile?: unknown; webDist?: string | null; allowedHosts?: () => string[]; source?: FakeSource; pageReader?: FakePageReader; printer?: FakePrinter; logger?: Logger; revokeTimeoutMs?: number; installMode?: string; autoKey?: boolean } = {}) {
  // Spaces + Cyrillic on purpose: real user folders look like C:\Users\Ольга Коваль\.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp app Дані-'));
  const settings = new SettingsStore(path.join(dir, 'settings.json'));
  // `settingsFile`: a settings.json already on disk before start (simulates a restart); taken as-is.
  if (opts.settingsFile !== undefined) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(opts.settingsFile));
  settings.load();
  // Test apps have Claude chosen unless a test asks otherwise; `chosen: null` = "Continue anyway" person.
  if (opts.settingsFile === undefined && opts.chosen !== null) settings.patch({ llm: { provider: opts.chosen ?? 'claude' } });
  const profileFile = path.join(dir, 'profile', 'profile.json');
  const filesDir = path.join(dir, 'profile', 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const profileStore = new ProfileStore(profileFile);
  profileStore.load();
  const profileFiles = new ProfileFiles(filesDir);
  const provider = opts.provider ?? new FakeProvider();
  const chatgpt = opts.chatgpt ?? new FakeProvider(undefined, undefined, 'chatgpt');
  const providers = new ProviderRegistry({ claude: provider, chatgpt }, () => settings.get().llm.provider);
  let shutdownCalls = 0;
  const queue = new LlmQueue(() => providers.current());
  const vacancyStore = new VacancyStore({ file: path.join(dir, 'vacancies', 'vacancies.json'), textsDir: path.join(dir, 'vacancies', 'texts') });
  vacancyStore.load();
  const source = opts.source ?? fakeSource();
  const pageReader = opts.pageReader ?? new FakePageReader();
  const searchJob = new SearchJob({
    store: vacancyStore, source, queue, logger: nullLogger, profile: () => profileStore.get(),
    language: () => settings.get().language ?? 'en', publishedWithinDays: () => settings.get().vacancies.publishedWithinDays,
    stateFile: path.join(dir, 'vacancies', 'search-state.json'), pauseMs: 0,
  });
  searchJob.init();
  const printer = opts.printer ?? new FakePrinter();
  const applicationStore = new ApplicationStore(path.join(dir, 'applications'));
  applicationStore.load();
  const applicationJob = new ApplicationJob({
    store: applicationStore, vacancies: vacancyStore, queue, printer, logger: nullLogger,
    profile: () => profileStore.get(), photo: (p) => profilePhoto(p, profileFiles),
    stateFile: path.join(dir, 'applications', 'job-state.json'),
  });
  applicationJob.init();
  const logger = opts.logger ?? nullLogger;
  const mailer = new FakeMailer();
  const googleAuth = new FakeGoogleAuth();
  const secrets = new MemorySecretStore();
  const sentUnsaved = new SentUnsavedLog(path.join(dir, 'applications', 'sent-unsaved.json'));
  sentUnsaved.load();
  const activity = new Activity();
  // Outside the data folder, like Documents: a backup never contains the backups.
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp backups-'));
  const openedFolders: string[] = [];
  // Never the real installers: the fake one only prints / fails / hangs.
  const fakeInstall = fileURLToPath(new URL('../fixtures/fake-install.mjs', import.meta.url));
  const fakeCmd = () => ({ file: process.execPath, args: [fakeInstall, opts.installMode ?? 'ok'] });
  const install = new InstallJob({ commands: { claude: fakeCmd, chatgpt: fakeCmd }, timeoutMs: 1500 });
  const app = await buildApp({
    settings, providers, install, queue, logger, version: '0.1.0',
    webDist: opts.webDist ?? null,
    allowedHosts: opts.allowedHosts ?? (() => ['localhost:80']),
    onShutdown: () => { shutdownCalls++; },
    profileStore, profileFiles, vacancyStore, vacancySource: source, pageReader, searchJob,
    applicationStore, applicationJob, printer, mailer, secrets, sentUnsaved,
    googleAuth, origin: () => 'http://localhost:80', revokeTimeoutMs: opts.revokeTimeoutMs,
    session: { key: TEST_KEY, cookieName: 'bp_key_80' },
    activity,
    backup: {
      paths: dataPaths(dir), dir: async () => { fs.mkdirSync(backupDir, { recursive: true }); return backupDir; },
      openFolder: (d) => { openedFolders.push(d); },
      reload: () => {
        settings.load(); profileStore.load(); vacancyStore.load(); applicationStore.load(); sentUnsaved.load();
        searchJob.init(); applicationJob.init();
      },
    },
  });
  if (opts.autoKey !== false) {
    const inject = app.inject.bind(app) as (o: InjectOptions | string) => Promise<LightMyRequestResponse>;
    app.inject = ((o: InjectOptions | string) => {
      if (typeof o !== 'object') return inject(o);
      const headers: Record<string, unknown> = { ...(o.headers ?? {}) };
      if (!('x-bp-key' in headers) && !('cookie' in headers)) headers['x-bp-key'] = TEST_KEY;
      return inject({ ...o, headers } as InjectOptions);
    }) as unknown as typeof app.inject;
  }
  return { app, googleAuth, provider, chatgpt, providers, settings, profileStore, profileFiles, profileFile, filesDir, shutdownCalls: () => shutdownCalls, vacancyStore, searchJob, source, pageReader, dir, applicationStore, applicationJob, printer, mailer, secrets, sentUnsaved, activity, backupDir, openedFolders };
}
