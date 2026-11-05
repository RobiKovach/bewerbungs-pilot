import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { LlmCheck } from '@bp/shared';
import { PROVIDER_IDS, PUBLISHED_WITHIN_DAYS, SUPPORTED_LANGUAGES, settingsView, type Language, type ProviderId, type SettingsPatch, type SettingsStore } from './data/settings.js';
import { AppError, httpStatusFor } from './errors.js';
import type { Logger } from './log.js';
import { keyMatches, readCookie } from './runtime/launch-key.js';
import type { LlmQueue } from './llm/queue.js';
import type { InstallJob } from './llm/install.js';
import type { ProviderRegistry } from './llm/providers.js';
import { helloTask } from './prompts/hello.js';
import type { ProfileFiles } from './profile/files.js';
import { registerProfileRoutes } from './profile/routes.js';
import type { ProfileStore } from './profile/store.js';
import type { ApplicationJob } from './applications/job.js';
import type { PdfPrinter } from './applications/pdf.js';
import { registerApplicationRoutes } from './applications/routes.js';
import { registerInterviewRoutes } from './interview/routes.js';
import type { ApplicationStore } from './applications/store.js';
import type { GoogleAuth } from './mail/google-auth.js';
import type { Mailer } from './mail/mailer.js';
import type { SentUnsavedLog } from './applications/sent-unsaved.js';
import { registerMailRoutes } from './mail/routes.js';
import type { SecretStore } from './mail/secret.js';
import { registerVacancyRoutes } from './vacancies/routes.js';
import type { PageReader } from './vacancies/sources/page-reader.js';
import type { PdfFetcher } from './vacancies/sources/pdf-fetch.js';
import type { ContactWindow } from './vacancies/sources/aa-contact-window.js';
import type { SearchJob } from './vacancies/search-job.js';
import type { VacancySource } from './vacancies/sources/types.js';
import type { VacancyStore } from './vacancies/store.js';
import { registerBackupRoutes, type BackupRouteDeps } from './backup/routes.js';
import { profileHasData, registerTransferRoutes, removeTransferLeftovers } from './backup/transfer-routes.js';
import type { Activity } from './runtime/activity.js';
import type { AvailableUpdate } from './updates/checker.js';
import { registerUpdateRoutes } from './updates/routes.js';
import { UpdateApplier, UpdateOutcome, type SpawnOptions } from './updates/apply.js';
import type { Updater } from './updates/updater.js';
import { cloudUrl } from './usage/cloud.js';
import { registerUsageRoutes } from './usage/routes.js';

export interface AppDeps {
  settings: SettingsStore;
  /** All AI helpers; the current one is read from settings on every request. */
  providers: ProviderRegistry;
  install: InstallJob;
  queue: LlmQueue;
  logger: Logger;
  version: string;
  webDist: string | null;
  /** Accepted Host header values, e.g. ["127.0.0.1:4280", "localhost:4280"]. */
  allowedHosts: () => string[];
  onShutdown: () => void;
  profileStore: ProfileStore;
  profileFiles: ProfileFiles;
  vacancyStore: VacancyStore;
  vacancySource: VacancySource;
  /** Opens pasted vacancy links that are not Arbeitsagentur (spec, section 6a). */
  pageReader: PageReader;
  /** Downloads PDFs behind pasted links (link field and the note, spec 0.9.1 A). */
  pdfFetcher: PdfFetcher;
  /** The visible "find contact" window for Arbeitsagentur offers (spec 0.9.1 B; used by the contact routes). */
  contactWindow: ContactWindow;
  searchJob: SearchJob;
  applicationStore: ApplicationStore;
  applicationJob: ApplicationJob;
  printer: PdfPrinter;
  mailer: Mailer;
  secrets: SecretStore;
  /** Emails that went out but were not recorded (never sent again). */
  sentUnsaved: SentUnsavedLog;
  googleAuth: GoogleAuth;
  /** The address this server is reached at, e.g. `http://127.0.0.1:4280` (the Google sign-in comes back to it). */
  origin: () => string;
  /** How long "Disconnect" waits for Google to revoke the key (default 10 s). */
  revokeTimeoutMs?: number;
  /** This launch's key (also in server.json) and the port-named cookie that carries it in the browser. */
  session: { key: string; cookieName: string };
  /** Work in flight without its own job state (sends, a restore). */
  activity: Activity;
  /** Backups (spec 0.9.0): the data folder, the backup folder, re-reading every store after a restore, Explorer. */
  backup: Pick<BackupRouteDeps, 'paths' | 'folder' | 'reload' | 'openFolder' | 'maxUploadBytes'>;
  /** What the daily update check found (spec 0.9.0, 3.3). */
  updates: {
    available: () => AvailableUpdate | null;
    /** Whether the demo copy (its own program, started from this app) is running; an update must wait for it to be closed. */
    demoRunning?: () => boolean;
    /** One-click update (0.11.0): production passes the real Updater and spawn; tests pass fakes. Shutdown is `onShutdown`. */
    apply?: { updater: Pick<Updater, 'prepare'>; spawn: (file: string, args: string[], opts: SpawnOptions) => Promise<{ kill?: () => void } | void>; statusFile: string; outcome: UpdateOutcome; startWaitMs?: number; startPollMs?: number };
  };
  /** Our cloud service for feedback (spec 0.11.0); tests inject `fetch` and a URL. Default: the real one. */
  cloud?: { url: string; fetch?: typeof fetch };
  /** «Try the demo» (spec 0.10.0): `active` = this copy is the demo; `start` opens the demo copy from the real app. */
  demo?: { active: boolean; start?: (language: Language) => Promise<{ url: string }> };
}

/**
 * Routes anyone on this PC may call without the launch key — matched against the route Fastify chose
 * (`req.routeOptions.url`), never the raw URL. `/` and `/*` are the web files (no personal data in them);
 * the Google callback arrives from accounts.google.com, so the SameSite=Strict cookie is not sent with it
 * (it is protected by state + PKCE and shows fixed texts only).
 */
/**
 * Reading a link or the Arbeitsagentur contact window can take minutes (a person solves a captcha): while one is open
 * it counts as work in flight, so an update does not start in the middle of it.
 */
function browserWork<T extends { read?: (...a: never[]) => Promise<unknown>; readContact?: (...a: never[]) => Promise<unknown> }>(activity: Activity, inner: T): T {
  const wrap = <F extends (...a: never[]) => Promise<unknown>>(fn: F, self: unknown) => (async (...a: never[]) => {
    activity.refuseDuringUpdate();
    const end = activity.begin('browser');
    try { return await fn.apply(self, a); } finally { end(); }
  }) as F;
  return { ...inner, ...(inner.read ? { read: wrap(inner.read, inner) } : {}), ...(inner.readContact ? { readContact: wrap(inner.readContact, inner) } : {}) };
}

const PUBLIC_ROUTES = new Set(['/open', '/api/health', '/oauth/google/callback', '/', '/*']);

const settingsPatchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: { type: 'string', enum: [...SUPPORTED_LANGUAGES] },
    onboarding: {
      type: 'object',
      additionalProperties: false,
      properties: {
        currentStep: { type: ['string', 'null'], maxLength: 64 },
        completed: { type: 'boolean' },
      },
    },
    llm: {
      type: 'object', additionalProperties: false, required: ['provider'],
      properties: { provider: { type: 'string', enum: [...PROVIDER_IDS] } },
    },
    vacancies: {
      type: 'object',
      additionalProperties: false,
      required: ['publishedWithinDays'],
      properties: { publishedWithinDays: { type: 'integer', enum: [...PUBLISHED_WITHIN_DAYS] } },
    },
    updates: {
      type: 'object', additionalProperties: false, required: ['check'],
      properties: { check: { type: 'boolean' } },
    },
    usage: {
      type: 'object', additionalProperties: false,
      properties: { ping: { type: 'boolean' }, noticeShown: { type: 'boolean', const: true } },
    },
  },
} as const;

const languageBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['language'],
  properties: { language: { type: 'string', enum: [...SUPPORTED_LANGUAGES] } },
} as const;

const errorBody = (code: string, detailsForLog: string, reason?: string, params?: Record<string, string | number>) => ({
  error: { code, detailsForLog, ...(reason ? { reason } : {}), ...(params ? { params } : {}) },
});

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });

  // Only this PC's browser tab may talk to us: foreign Host = DNS rebinding; a custom header on
  // writes cannot be sent cross-site without a CORS preflight, which we never allow. Decided by
  // method alone (not by matching the request path against '/api/') because the path can be
  // percent-encoded or given in absolute-form and still route to an API handler after decoding.
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!deps.allowedHosts().includes(host)) {
      return reply.code(403).send(errorBody('BAD_REQUEST', `host not allowed: ${host}`));
    }
    // Other programs and other Windows users on this PC can reach 127.0.0.1 too; only the launch key
    // (readable from server.json by this Windows user alone) tells the person's own browser tab apart.
    // An unmatched route (the not-found handler) has no routeOptions.url and therefore needs the key.
    const route = req.routeOptions.url;
    if (!(route !== undefined && PUBLIC_ROUTES.has(route))) {
      const given = req.headers['x-bp-key'];
      const key = typeof given === 'string' ? given : readCookie(req.headers.cookie, deps.session.cookieName);
      if (!keyMatches(key, deps.session.key)) {
        return reply.code(httpStatusFor('NO_SESSION')).send(errorBody('NO_SESSION', 'missing or wrong launch key'));
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-bp-client'] !== '1') {
      return reply.code(403).send(errorBody('BAD_REQUEST', 'missing X-BP-Client header'));
    }
  });

  // No other website may show our pages inside a frame (clickjacking), and the browser must not guess
  // content types. default-src 'self' covers the Vite build: one external module script + one stylesheet,
  // no inline <script>/<style>, no fonts from elsewhere (React's style={...} goes through CSSOM, which CSP does
  // not restrict). Images additionally allow blob: (img-src below); nothing is loaded from other sites.
  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.hasHeader('X-Frame-Options')) reply.header('X-Frame-Options', 'DENY');
    // img-src blob: = the photo the person just picked, shown in the cropper before it is uploaded.
    if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; frame-ancestors 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      deps.logger.warn('app_error', { code: err.code, details: err.detailsForLog, url: req.url });
      return reply.code(httpStatusFor(err.code)).send(errorBody(err.code, err.detailsForLog, err.reason, err.params));
    }
    const e = err as Error & { validation?: unknown; statusCode?: number };
    if (e.validation) {
      deps.logger.warn('validation_error', { message: e.message, url: req.url });
      return reply.code(400).send(errorBody('BAD_REQUEST', e.message));
    }
    // Fastify's own client-error paths (malformed JSON, missing/wrong content-type, payload too
    // large, ...) throw plain errors with a statusCode but no `validation` property.
    if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
      deps.logger.warn('client_error', { statusCode: e.statusCode, message: e.message, url: req.url });
      return reply.code(e.statusCode).send(errorBody('BAD_REQUEST', e.message));
    }
    deps.logger.error('unhandled_error', { message: e.message, stack: e.stack, url: req.url });
    return reply.code(500).send(errorBody('UNKNOWN', e.message));
  });

  app.get('/api/health', async () => ({ ok: true, app: 'bewerbungs-pilot', version: deps.version, demo: deps.demo?.active === true }));

  app.post('/api/demo', { schema: { body: languageBodySchema } }, async (req) => {
    const start = deps.demo?.start;
    if (deps.demo?.active || !start) throw new AppError('BAD_REQUEST', 'the demo cannot be started from here');
    return start((req.body as { language: Language }).language);
  });

  // The shortcut opens /open?key=…: the right key becomes a session cookie (no Expires = gone when the
  // browser closes; a restart makes a new key anyway). A wrong or missing key just goes on to the app,
  // which then shows "open via the shortcut".
  app.get('/open', async (req, reply) => {
    const { key } = req.query as { key?: string };
    if (keyMatches(typeof key === 'string' ? key : undefined, deps.session.key)) {
      reply.header('Set-Cookie', `${deps.session.cookieName}=${deps.session.key}; HttpOnly; SameSite=Strict; Path=/`);
    }
    return reply.code(303).header('Location', '/').send();
  });

  app.get('/api/settings', async () => settingsView(deps.settings.get()));

  app.patch('/api/settings', { schema: { body: settingsPatchSchema } }, async (req) =>
    settingsView(deps.settings.patch(req.body as SettingsPatch)),
  );

  /** No `provider` (or empty) = the current helper; an unknown name is a mistake, never silently the current one. */
  const providerOf = (raw: unknown): ProviderId | null => {
    if (raw === undefined || raw === '') return null;
    const id = PROVIDER_IDS.find((x) => x === raw);
    if (!id) throw new AppError('BAD_REQUEST', 'unknown provider');
    return id;
  };

  app.get('/api/llm/check', async (req): Promise<LlmCheck> => {
    const q = req.query as { refresh?: string; provider?: string };
    const id = providerOf(q.provider) ?? deps.providers.currentId();
    // No helper chosen yet: answer (not throw) so the Settings page can still render.
    if (!id) return { provider: null, availability: { ok: false, reason: 'error' }, queue: deps.queue.status() };
    return { provider: id, availability: await deps.providers.get(id).checkAvailable({ refresh: q.refresh === '1' }), queue: deps.queue.status() };
  });

  app.post('/api/llm/test', { schema: { body: languageBodySchema } }, async (req, reply) => {
    const { language } = req.body as { language: Language };
    const ctrl = new AbortController();
    // Tab closed / "Cancel" clicked before we answered -> stop Claude.
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) ctrl.abort(); });
    return deps.queue.run<{ greeting: string }>(helloTask(language), ctrl.signal);
  });

  app.get('/api/llm/install', async () => deps.install.status());
  app.post('/api/llm/install', {
    // Fastify's Ajv strips unknown keys by default; here an extra key (e.g. a package name) must be refused, not ignored.
    preValidation: async (req) => {
      const b = req.body;
      if (b && typeof b === 'object' && Object.keys(b).some((k) => k !== 'provider')) throw new AppError('BAD_REQUEST', 'only { provider } is accepted');
    },
    schema: { body: { type: 'object', additionalProperties: false, required: ['provider'], properties: { provider: { type: 'string', enum: [...PROVIDER_IDS] } } } },
  }, async (req, reply) => {
    deps.activity.refuseDuringUpdate();
    return reply.code(202).send(deps.install.start((req.body as { provider: ProviderId }).provider));
  });

  app.post('/api/llm/open-login', async (req) => {
    const id = providerOf((req.body as { provider?: string } | undefined)?.provider) ?? deps.providers.currentId();
    if (!id) throw new AppError('LLM_NOT_CHOSEN', 'no AI helper chosen');
    const p = deps.providers.get(id);
    if (!p.openLogin) throw new AppError('BAD_REQUEST', 'provider has no sign-in window');
    p.openLogin();
    return { ok: true };
  });

  app.post('/api/shutdown', async (_req, reply) => {
    reply.raw.once('finish', deps.onShutdown);
    reply.send({ ok: true });
    return reply;
  });

  await registerProfileRoutes(app, {
    store: deps.profileStore, files: deps.profileFiles, queue: deps.queue, logger: deps.logger,
    language: () => deps.settings.get().language ?? 'en',
  });

  await registerVacancyRoutes(app, {
    store: deps.vacancyStore, source: deps.vacancySource, pageReader: browserWork(deps.activity, deps.pageReader), pdfFetcher: deps.pdfFetcher, contactWindow: browserWork(deps.activity, deps.contactWindow), queue: deps.queue, job: deps.searchJob, logger: deps.logger, activity: deps.activity,
    profile: () => deps.profileStore.get(), language: () => deps.settings.get().language ?? 'en',
  });

  await registerApplicationRoutes(app, {
    store: deps.applicationStore, job: deps.applicationJob, printer: deps.printer, vacancies: deps.vacancyStore,
    files: deps.profileFiles, profile: () => deps.profileStore.get(), logger: deps.logger,
    settings: deps.settings, mailer: deps.mailer, secrets: deps.secrets, sentUnsaved: deps.sentUnsaved, queue: deps.queue,
    activity: deps.activity,
  });

  await registerInterviewRoutes(app, {
    store: deps.applicationStore, vacancies: deps.vacancyStore, profile: () => deps.profileStore.get(), settings: deps.settings,
    queue: deps.queue, activity: deps.activity, logger: deps.logger,
  });

  await registerMailRoutes(app, { settings: deps.settings, mailer: deps.mailer, secrets: deps.secrets, logger: deps.logger,
    googleAuth: deps.googleAuth, origin: deps.origin, activity: deps.activity, revokeTimeoutMs: deps.revokeTimeoutMs });

  // After the profile routes: restore-upload uses the multipart parser they register.
  await registerBackupRoutes(app, {
    ...deps.backup, version: deps.version, searchJob: deps.searchJob, applicationJob: deps.applicationJob, queue: deps.queue,
    activity: deps.activity, settings: deps.settings, secrets: deps.secrets, googleAuth: deps.googleAuth, logger: deps.logger,
    revokeTimeoutMs: deps.revokeTimeoutMs,
  });

  await removeTransferLeftovers(deps.backup.paths.tmp, (event, data) => deps.logger.warn(event, data));
  await registerTransferRoutes(app, {
    paths: deps.backup.paths, version: deps.version, activity: deps.activity, logger: deps.logger, maxUploadBytes: deps.backup.maxUploadBytes,
    hasData: () => deps.vacancyStore.list().length > 0 || deps.applicationStore.list().length > 0 || profileHasData(deps.profileStore.get()),
  });

  await registerUsageRoutes(app, { settings: deps.settings, version: deps.version, url: deps.cloud?.url ?? cloudUrl(), fetch: deps.cloud?.fetch, logger: deps.logger });
  // The demo copy has no one-click update (its installer would act on the real program and data).
  const applier = deps.updates.apply && deps.demo?.active !== true ? new UpdateApplier({
    updater: deps.updates.apply.updater, activity: deps.activity, available: () => deps.updates.available(), version: deps.version,
    enabled: () => deps.settings.get().updates.check, statusFile: deps.updates.apply.statusFile, spawn: deps.updates.apply.spawn, startWaitMs: deps.updates.apply.startWaitMs, startPollMs: deps.updates.apply.startPollMs,
    shutdown: deps.onShutdown, logger: deps.logger,
    busy: () => {
      const active = deps.activity.active();
      if (deps.updates.demoRunning?.()) return 'demo';
      if (active.includes('restore')) return 'restore';
      if (deps.searchJob.state().state === 'running') return 'search';
      if (deps.applicationJob.state().state === 'running') return 'package';
      const q = deps.queue.status();
      if (q.running || q.queued > 0 || active.includes('interview')) return 'ai';
      if (active.includes('send')) return 'send';
      if (deps.install.status().state === 'running') return 'install';
      if (active.includes('browser')) return 'browser';
      return null;
    },
  }) : undefined;
  await registerUpdateRoutes(app, { settings: deps.settings, version: deps.version, available: () => deps.updates.available(), apply: applier, outcome: deps.updates.apply?.outcome, installable: deps.demo?.active !== true });

  if (deps.webDist && fs.existsSync(deps.webDist)) {
    await app.register(fastifyStatic, { root: deps.webDist, prefix: '/' });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET' || !deps.webDist || !fs.existsSync(deps.webDist)) {
      return reply.code(404).send(errorBody('NOT_FOUND', `${req.method} ${req.url}`));
    }
    return reply.sendFile('index.html');
  });

  return app;
}
