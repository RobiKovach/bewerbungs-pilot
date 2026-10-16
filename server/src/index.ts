import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApplicationJob } from './applications/job.js';
import { BrowserPrinter } from './applications/pdf.js';
import { ApplicationStore } from './applications/store.js';
import { profilePhoto } from './applications/views.js';
import { buildApp } from './app.js';
import { writeJsonAtomic } from './data/atomic.js';
import { dataPaths, ensureDataDirs, resolveDataRoot } from './data/paths.js';
import { SettingsStore } from './data/settings.js';
import { ClaudeCodeProvider } from './llm/claude-code.js';
import { CodexCliProvider, codexSearchRoots } from './llm/codex-cli.js';
import { FakeProvider } from './llm/fake.js';
import { InstallJob } from './llm/install.js';
import { ProviderRegistry } from './llm/providers.js';
import { LlmQueue } from './llm/queue.js';
import type { LlmProvider } from './llm/types.js';
import { createFileLogger } from './log.js';
import { GmailApiMailer } from './mail/gmail-api.js';
import { LibraryGoogleAuth } from './mail/google-auth.js';
import { SmtpMailer } from './mail/mailer.js';
import { MailRouter } from './mail/router.js';
import { SentUnsavedLog } from './applications/sent-unsaved.js';
import { DpapiSecretStore } from './mail/secret.js';
import { ProfileFiles } from './profile/files.js';
import { ProfileStore } from './profile/store.js';
import { openBrowser } from './runtime/browser.js';
import { findRunningInstance, waitForRunningInstance, type ServerInfo } from './runtime/instance.js';
import { acquireInstanceLock, createShutdown } from './runtime/lifecycle.js';
import { findFreePort } from './runtime/port.js';
import { ArbeitsagenturSource } from './vacancies/sources/arbeitsagentur.js';
import { SearchJob } from './vacancies/search-job.js';
import { VacancyStore } from './vacancies/store.js';

const HOST = '127.0.0.1';
const noOpen = process.argv.includes('--no-open') || process.env.BP_NO_OPEN === '1';
const fakeLlm = process.argv.includes('--fake-llm') || process.env.BP_FAKE_LLM === '1';
const WINNER_WAIT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 3000;

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

  // Two quick double-clicks can both get past the check above; the lock lets exactly one of them start a server.
  const lock = acquireInstanceLock(paths.lock);
  if (!lock) {
    const winner = await waitForRunningInstance(paths.server, WINNER_WAIT_MS);
    logger.info('lost_start_race', { port: winner });
    if (winner !== null && !noOpen) openBrowser(`http://${HOST}:${winner}/`);
    return;
  }
  process.on('exit', () => lock.release());

  const settings = new SettingsStore(paths.settings, (event, data) => logger.warn(event, data));
  settings.load();
  const profileStore = new ProfileStore(paths.profileFile, (event, data) => logger.warn(event, data));
  profileStore.load();
  const profileFiles = new ProfileFiles(paths.profileFiles);
  const claude: LlmProvider = fakeLlm ? new FakeProvider(undefined, undefined, 'claude')
    : new ClaudeCodeProvider({ tmpRoot: paths.tmp, timeoutMs: () => settings.get().llm.timeoutSec * 1000, logger });
  const chatgpt: LlmProvider = fakeLlm ? new FakeProvider(undefined, undefined, 'chatgpt')
    : new CodexCliProvider({ tmpRoot: paths.tmp, timeoutMs: () => settings.get().llm.timeoutSec * 1000, logger });
  const providers = new ProviderRegistry({ claude, chatgpt }, () => settings.get().llm.provider);
  const version = (JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));

  const port = await findFreePort(HOST, 4280, 4299);
  // After a successful install the provider must be re-probed, not served from its availability cache.
  // If the fresh install still cannot be found, log where we looked (the card then asks for a restart).
  const install = new InstallJob({
    logger,
    onDone: (id) => void providers.get(id).checkAvailable({ refresh: true }).then((a) => {
      if (!a.ok && a.reason === 'not-installed') {
        logger.warn('ai_install_done_not_found', {
          provider: id,
          searched: id === 'chatgpt' ? codexSearchRoots() : (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean),
        });
      }
    }).catch(() => undefined),
  });
  const queue = new LlmQueue(() => providers.current());
  const vacancyStore = new VacancyStore({ file: paths.vacanciesFile, textsDir: paths.vacancyTexts }, (event, data) => logger.warn(event, data));
  vacancyStore.load();
  const vacancySource = new ArbeitsagenturSource();
  const searchJob = new SearchJob({
    store: vacancyStore, source: vacancySource, queue, logger,
    profile: () => profileStore.get(), language: () => settings.get().language ?? 'en',
    publishedWithinDays: () => settings.get().vacancies.publishedWithinDays, stateFile: paths.searchState,
  });
  searchJob.init();
  const applicationStore = new ApplicationStore(paths.applications, (event, data) => logger.warn(event, data));
  applicationStore.load();
  const sentUnsaved = new SentUnsavedLog(path.join(paths.applications, 'sent-unsaved.json'), (event, data) => logger.warn(event, data));
  sentUnsaved.load();
  const printer = new BrowserPrinter({ tmpRoot: paths.tmp, warn: (event, data) => logger.warn(event, data) });
  const applicationJob = new ApplicationJob({
    store: applicationStore, vacancies: vacancyStore, queue, printer, logger,
    profile: () => profileStore.get(), photo: (p) => profilePhoto(p, profileFiles),
    stateFile: path.join(paths.applications, 'job-state.json'),
  });
  applicationJob.init();
  const googleAuth = new LibraryGoogleAuth();
  const app = await buildApp({
    settings, providers, install, queue, logger, version,
    webDist: fs.existsSync(webDist) ? webDist : null,
    allowedHosts: () => [`${HOST}:${port}`, `localhost:${port}`],
    onShutdown: () => void shutdown(),
    profileStore, profileFiles, vacancyStore, vacancySource, searchJob,
    applicationStore, applicationJob, printer,
    mailer: new MailRouter(new SmtpMailer(), new GmailApiMailer(googleAuth)), secrets: new DpapiSecretStore(paths.mailSecret), sentUnsaved,
    googleAuth, origin: () => `http://${HOST}:${port}`,
  });

  const shutdown = createShutdown({
    abortAll: () => { searchJob.stop(); applicationJob.cancel(); queue.abortAll(); },
    close: () => app.close(),
    releaseLock: () => lock.release(),
    serverFile: paths.server,
    closeTimeoutMs: CLOSE_TIMEOUT_MS,
    logger,
    exit: (code) => process.exit(code),
  });

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
