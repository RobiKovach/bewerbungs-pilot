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
import { resolveBackupFolder } from '../../src/backup/folder.js';
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
import type { AvailableUpdate } from '../../src/updates/checker.js';
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
export async function makeApp(opts: { provider?: FakeProvider; chatgpt?: FakeProvider; chosen?: ProviderId | null; settingsFile?: unknown; webDist?: string | null; allowedHosts?: () => string[]; source?: FakeSource; pageReader?: FakePageReader; printer?: FakePrinter; logger?: Logger; revokeTimeoutMs?: number; installMode?: string; autoKey?: boolean; update?: AvailableUpdate | null; updateSource?: () => AvailableUpdate | null; maxBackupUploadBytes?: number; documents?: string; backupEnv?: NodeJS.ProcessEnv } = {}) {
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
  // One logger for the routes and the jobs: a test that spies on it sees everything the app would log.
  const logger = opts.logger ?? nullLogger;
  const searchJob = new SearchJob({
    store: vacancyStore, source, queue, logger, profile: () => profileStore.get(),
    language: () => settings.get().language ?? 'en', publishedWithinDays: () => settings.get().vacancies.publishedWithinDays,
    stateFile: path.join(dir, 'vacancies', 'search-state.json'), pauseMs: 0,
  });
  searchJob.init();
  const printer = opts.printer ?? new FakePrinter();
  const applicationStore = new ApplicationStore(path.join(dir, 'applications'));
  applicationStore.load();
  const applicationJob = new ApplicationJob({
    store: applicationStore, vacancies: vacancyStore, queue, printer, logger,
    profile: () => profileStore.get(), photo: (p) => profilePhoto(p, profileFiles),
    stateFile: path.join(dir, 'applications', 'job-state.json'),
  });
  applicationJob.init();
  const mailer = new FakeMailer();
  const googleAuth = new FakeGoogleAuth();
  const secrets = new MemorySecretStore();
  const sentUnsaved = new SentUnsavedLog(path.join(dir, 'applications', 'sent-unsaved.json'));
  sentUnsaved.load();
  const activity = new Activity();
  // Outside the data folder, like Documents: a backup never contains the backups. The real folder rules run against a
  // stand-in Documents folder and an environment without OneDrive (opts.backupEnv / opts.documents change both).
  const documents = opts.documents ?? fs.mkdtempSync(path.join(os.tmpdir(), 'bp documents-'));
  const backupEnv: NodeJS.ProcessEnv = opts.backupEnv ?? { USERPROFILE: fs.mkdtempSync(path.join(os.tmpdir(), 'bp home-')) };
  const backupDir = path.join(documents, 'BewerbungsPilot', 'Backups');
  fs.mkdirSync(backupDir, { recursive: true });
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
      paths: dataPaths(dir), folder: (chosen) => resolveBackupFolder(chosen, { env: backupEnv, documents: async () => documents }),
      openFolder: (d) => { openedFolders.push(d); }, maxUploadBytes: opts.maxBackupUploadBytes,
      reload: () => {
        settings.load(); profileStore.load(); vacancyStore.load(); applicationStore.load(); sentUnsaved.load();
        searchJob.init(); applicationJob.init();
      },
    },
    // `update`: what the daily check found; `updateSource` when a test changes it later.
    updates: { available: opts.updateSource ?? (() => opts.update ?? null) },
  });
  if (opts.autoKey !== false) {
    const inject = app.inject.bind(app) as (o: InjectOptions | string) => Promise<LightMyRequestResponse>;
    app.inject = ((o: InjectOptions | string) => {
      if (typeof o !== 'object') return inject(o);
      const headers: Record<string, unknown> = { ...(o.headers ?? {}) };
      // Header names are case-insensitive: a test's own 'X-BP-Key' or 'Cookie' must win, not get a second key added.
      if (!Object.keys(headers).some((k) => ['x-bp-key', 'cookie'].includes(k.toLowerCase()))) headers['x-bp-key'] = TEST_KEY;
      return inject({ ...o, headers } as InjectOptions);
    }) as unknown as typeof app.inject;
  }
  return { app, googleAuth, provider, chatgpt, providers, settings, profileStore, profileFiles, profileFile, filesDir, shutdownCalls: () => shutdownCalls, vacancyStore, searchJob, source, pageReader, dir, applicationStore, applicationJob, printer, mailer, secrets, sentUnsaved, activity, backupDir, documents, openedFolders };
}
