import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApplicationJob } from '../../src/applications/job.js';
import { ApplicationStore } from '../../src/applications/store.js';
import { profilePhoto } from '../../src/applications/views.js';
import { buildApp } from '../../src/app.js';
import { SettingsStore } from '../../src/data/settings.js';
import { FakeProvider } from '../../src/llm/fake.js';
import { LlmQueue } from '../../src/llm/queue.js';
import { nullLogger, type Logger } from '../../src/log.js';
import { MemorySecretStore } from '../../src/mail/secret.js';
import { ProfileFiles } from '../../src/profile/files.js';
import { ProfileStore } from '../../src/profile/store.js';
import { SearchJob } from '../../src/vacancies/search-job.js';
import { VacancyStore } from '../../src/vacancies/store.js';
import { FakePrinter } from './applications.js';
import { FakeMailer } from './mail.js';
import { fakeSource, type FakeSource } from './vacancies.js';

export const H = { 'x-bp-client': '1' };

export async function makeApp(opts: { provider?: FakeProvider; webDist?: string | null; allowedHosts?: () => string[]; source?: FakeSource; printer?: FakePrinter; logger?: Logger } = {}) {
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
  const queue = new LlmQueue(provider);
  const vacancyStore = new VacancyStore({ file: path.join(dir, 'vacancies', 'vacancies.json'), textsDir: path.join(dir, 'vacancies', 'texts') });
  vacancyStore.load();
  const source = opts.source ?? fakeSource();
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
  const secrets = new MemorySecretStore();
  const app = await buildApp({
    settings, provider, queue, logger, version: '0.1.0',
    webDist: opts.webDist ?? null,
    allowedHosts: opts.allowedHosts ?? (() => ['localhost:80']),
    onShutdown: () => { shutdownCalls++; },
    profileStore, profileFiles, vacancyStore, vacancySource: source, searchJob,
    applicationStore, applicationJob, printer, mailer, secrets,
  });
  return { app, provider, settings, profileStore, profileFiles, profileFile, filesDir, shutdownCalls: () => shutdownCalls, vacancyStore, searchJob, source, dir, applicationStore, applicationJob, printer, mailer, secrets };
}
