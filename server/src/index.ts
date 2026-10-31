import { spawn } from 'node:child_process';
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
import { SettingsStore, SUPPORTED_LANGUAGES, type Language } from './data/settings.js';
import { DemoLauncher, demoDataRoot, isDemoStart, seedDemo } from './demo/demo.js';
import { ClaudeCodeProvider } from './llm/claude-code.js';
import { CodexCliProvider, codexSearchRoots } from './llm/codex-cli.js';
import { FakeProvider } from './llm/fake.js';
import { scriptedResponse } from './llm/fake-scripted.js';
import { InstallJob } from './llm/install.js';
import { ProviderRegistry } from './llm/providers.js';
import { LlmQueue } from './llm/queue.js';
import type { LlmProvider } from './llm/types.js';
import { createFileLogger } from './log.js';
import { FakeFileMailer } from './mail/fake-file-mailer.js';
import { GmailApiMailer } from './mail/gmail-api.js';
import { LibraryGoogleAuth } from './mail/google-auth.js';
import { SmtpMailer } from './mail/mailer.js';
import { MailRouter } from './mail/router.js';
import { SentUnsavedLog } from './applications/sent-unsaved.js';
import { DpapiSecretStore } from './mail/secret.js';
import { ProfileFiles } from './profile/files.js';
import { ProfileStore } from './profile/store.js';
import { resolveBackupFolder } from './backup/folder.js';
import { Activity } from './runtime/activity.js';
import { openBrowser, openFolder } from './runtime/browser.js';
import { findRunningInstance, waitForRunningInstance, type RunningInstance, type ServerInfo } from './runtime/instance.js';
import { cookieName, newLaunchKey, openUrl } from './runtime/launch-key.js';
import { acquireInstanceLock, createShutdown } from './runtime/lifecycle.js';
import { findFreePort } from './runtime/port.js';
import { ArbeitsagenturSource } from './vacancies/sources/arbeitsagentur.js';
import { BrowserPageReader } from './vacancies/sources/page-reader.js';
import { AaContactWindow } from './vacancies/sources/aa-contact-window.js';
import { HttpPdfFetcher } from './vacancies/sources/pdf-fetch.js';
import { MANUAL_TEXT_MIN } from './vacancies/tasks/extract-manual.js';
import { SearchJob } from './vacancies/search-job.js';
import { UpdateChecker } from './updates/checker.js';
import { UPDATE_URL } from './updates/version-file.js';
import { VacancyStore } from './vacancies/store.js';

const HOST = '127.0.0.1';
const noOpen = process.argv.includes('--no-open') || process.env.BP_NO_OPEN === '1';
// Test/demo modes, only from the command line or the environment (never from settings or a request):
// --fake-llm answers every AI task from fake-scripted.ts; --fake-mail writes mails to <data>/tmp/fake-mail/ instead of sending.
// --demo (spec 0.10.0, started by «Try the demo»): both, on the demo folder, with the fictional Max Mustermann.
const demo = isDemoStart(process.argv, process.env);
const fakeLlm = demo || process.argv.includes('--fake-llm') || process.env.BP_FAKE_LLM === '1';
const fakeMail = demo || process.argv.includes('--fake-mail') || process.env.BP_FAKE_MAIL === '1';
const WINNER_WAIT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 3000;

/** Where the browser goes: with the key, /open turns it into the session cookie; a pre-0.8.3 server has none. */
const appUrl = (r: RunningInstance) => (r.key ? openUrl(HOST, r.port, r.key) : `http://${HOST}:${r.port}/`);

/** The demo's own folder unless the launcher (or a test) gave one: the demo never runs on the person's data. */
const dataRoot = () => (demo && !process.env.BP_DATA_DIR ? demoDataRoot(resolveDataRoot()) : resolveDataRoot());

async function main(): Promise<void> {
  const paths = dataPaths(dataRoot());
  ensureDataDirs(paths);
  const logger = createFileLogger(paths.logs);

  const running = await findRunningInstance(paths.server);
  if (running !== null) {
    if (!noOpen) openBrowser(appUrl(running));
    logger.info('already_running', { port: running.port });
    return;
  }

  // Two quick double-clicks can both get past the check above; the lock lets exactly one of them start a server.
  const lock = acquireInstanceLock(paths.lock);
  if (!lock) {
    const winner = await waitForRunningInstance(paths.server, WINNER_WAIT_MS);
    logger.info('lost_start_race', { port: winner?.port ?? null });
    if (winner !== null && !noOpen) openBrowser(appUrl(winner));
    return;
  }
  process.on('exit', () => lock.release());

  const settings = new SettingsStore(paths.settings, (event, data) => logger.warn(event, data));
  settings.load();
  const profileStore = new ProfileStore(paths.profileFile, (event, data) => logger.warn(event, data));
  profileStore.load();
  const profileFiles = new ProfileFiles(paths.profileFiles);
  const secrets = new DpapiSecretStore(paths.mailSecret);
  let demoLanguage: Language | null = null;
  if (demo) {
    const language = SUPPORTED_LANGUAGES.find((l) => l === process.env.BP_DEMO_LANGUAGE) ?? 'en';
    demoLanguage = language;
  }
  const claude: LlmProvider = fakeLlm ? new FakeProvider(undefined, scriptedResponse, 'claude')
    : new ClaudeCodeProvider({ tmpRoot: paths.tmp, timeoutMs: () => settings.get().llm.timeoutSec * 1000, logger });
  const chatgpt: LlmProvider = fakeLlm ? new FakeProvider(undefined, scriptedResponse, 'chatgpt')
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
    }).catch((err: unknown) => logger.warn('ai_install_recheck_failed', { provider: id, message: err instanceof Error ? err.message : String(err) })),
  });
  const queue = new LlmQueue(() => providers.current());
  const vacancyStore = new VacancyStore({ file: paths.vacanciesFile, textsDir: paths.vacancyTexts }, (event, data) => logger.warn(event, data));
  vacancyStore.load();
  if (demoLanguage !== null) await seedDemo({ settings, profileStore, vacancyStore, secrets, language: demoLanguage });
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
  const pageReader = new BrowserPageReader({ tmpRoot: paths.tmp, minChars: MANUAL_TEXT_MIN, warn: (event, data) => logger.warn(event, data), log: (event, data) => logger.info(event, data) });
  const pdfFetcher = new HttpPdfFetcher({ log: (event, data) => logger.info(event, data) });
  const contactWindow = new AaContactWindow({ tmpRoot: paths.tmp, warn: (event, data) => logger.warn(event, data), log: (event, data) => logger.info(event, data) });
  const applicationJob = new ApplicationJob({
    store: applicationStore, vacancies: vacancyStore, queue, printer, logger,
    profile: () => profileStore.get(), photo: (p) => profilePhoto(p, profileFiles),
    stateFile: path.join(paths.applications, 'job-state.json'),
  });
  applicationJob.init();
  const googleAuth = new LibraryGoogleAuth();
  const fakeMailDir = path.join(paths.tmp, 'fake-mail');
  const fileMailer = new FakeFileMailer(fakeMailDir);
  const updates = new UpdateChecker({
    url: process.env.BP_UPDATE_URL || UPDATE_URL, stateFile: path.join(paths.root, 'update-state.json'),
    currentVersion: version, enabled: () => settings.get().updates.check, logger,
  });
  const key = newLaunchKey();
  const app = await buildApp({
    settings, providers, install, queue, logger, version,
    webDist: fs.existsSync(webDist) ? webDist : null,
    allowedHosts: () => [`${HOST}:${port}`, `localhost:${port}`],
    onShutdown: () => void shutdown(),
    profileStore, profileFiles, vacancyStore, vacancySource, pageReader, pdfFetcher, contactWindow, searchJob,
    applicationStore, applicationJob, printer,
    mailer: fakeMail ? new MailRouter(fileMailer, fileMailer) : new MailRouter(new SmtpMailer(), new GmailApiMailer(googleAuth)), secrets, sentUnsaved,
    googleAuth, origin: () => `http://${HOST}:${port}`,
    session: { key, cookieName: cookieName(port) },
    activity: new Activity(),
    backup: {
      paths, folder: (chosen) => resolveBackupFolder(chosen), openFolder,
      // After a restore every store reads its files again (synchronous: nothing can start in between).
      reload: () => {
        settings.load(); profileStore.load(); vacancyStore.load(); applicationStore.load(); sentUnsaved.load();
        searchJob.init(); applicationJob.init();
      },
    },
    updates,
    demo: demo ? { active: true } : {
      active: false,
      start: (language) => new DemoLauncher({
        dataRoot: paths.root, entry: fileURLToPath(import.meta.url),
        // Detached: the demo is its own copy with its own Quit; it keeps running if this one is closed first.
        spawn: (file, args, opts) => spawn(file, args, { ...opts, detached: true, stdio: 'ignore' }).unref(),
        find: () => findRunningInstance(dataPaths(demoDataRoot(paths.root)).server),
      }).start(language),
    },
  });

  const shutdown = createShutdown({
    abortAll: () => { updates.stop(); searchJob.stop(); applicationJob.cancel(); queue.abortAll(); },
    close: () => app.close(),
    releaseLock: () => lock.release(),
    serverFile: paths.server,
    closeTimeoutMs: CLOSE_TIMEOUT_MS,
    logger,
    exit: (code) => process.exit(code),
  });

  await app.listen({ host: HOST, port });
  const info: ServerInfo = { port, pid: process.pid, startedAt: new Date().toISOString(), key };
  writeJsonAtomic(paths.server, info);
  logger.info('started', { port, version, fakeLlm, fakeMail, demo });
  if (fakeLlm || fakeMail) {
    logger.warn('fake_mode', { fakeLlm, fakeMail });
    const what = [fakeLlm && 'AI answers are scripted (--fake-llm)', fakeMail && `mail is written to ${fakeMailDir}, nothing is sent (--fake-mail)`];
    console.warn(`FAKE MODE — ${what.filter(Boolean).join('; ')}`);
  }
  updates.start();
  if (noOpen) console.log(`Open BewerbungsPilot: ${openUrl(HOST, port, key)}`);
  else openBrowser(openUrl(HOST, port, key));
}

main().catch((err: unknown) => {
  const paths = dataPaths(dataRoot());
  createFileLogger(paths.logs).error('fatal', { message: String(err), stack: (err as Error)?.stack });
  process.exit(1);
});
