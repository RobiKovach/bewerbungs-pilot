import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { PUBLISHED_WITHIN_DAYS, SUPPORTED_LANGUAGES, type Language, type SettingsPatch, type SettingsStore } from './data/settings.js';
import { AppError, httpStatusFor } from './errors.js';
import type { Logger } from './log.js';
import type { LlmQueue } from './llm/queue.js';
import type { LlmProvider } from './llm/types.js';
import { helloTask } from './prompts/hello.js';
import type { ProfileFiles } from './profile/files.js';
import { registerProfileRoutes } from './profile/routes.js';
import type { ProfileStore } from './profile/store.js';
import type { ApplicationJob } from './applications/job.js';
import type { PdfPrinter } from './applications/pdf.js';
import { registerApplicationRoutes } from './applications/routes.js';
import type { ApplicationStore } from './applications/store.js';
import { registerVacancyRoutes } from './vacancies/routes.js';
import type { SearchJob } from './vacancies/search-job.js';
import type { VacancySource } from './vacancies/sources/types.js';
import type { VacancyStore } from './vacancies/store.js';

export interface AppDeps {
  settings: SettingsStore;
  provider: LlmProvider;
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
  searchJob: SearchJob;
  applicationStore: ApplicationStore;
  applicationJob: ApplicationJob;
  printer: PdfPrinter;
}

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
    vacancies: {
      type: 'object',
      additionalProperties: false,
      required: ['publishedWithinDays'],
      properties: { publishedWithinDays: { type: 'integer', enum: [...PUBLISHED_WITHIN_DAYS] } },
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

  app.get('/api/health', async () => ({ ok: true, app: 'bewerbungs-pilot', version: deps.version }));

  app.get('/api/settings', async () => deps.settings.get());

  app.patch('/api/settings', { schema: { body: settingsPatchSchema } }, async (req) =>
    deps.settings.patch(req.body as SettingsPatch),
  );

  app.get('/api/llm/check', async (req) => {
    const refresh = (req.query as { refresh?: string }).refresh === '1';
    return { availability: await deps.provider.checkAvailable({ refresh }), queue: deps.queue.status() };
  });

  app.post('/api/llm/test', { schema: { body: languageBodySchema } }, async (req, reply) => {
    const { language } = req.body as { language: Language };
    const ctrl = new AbortController();
    // Tab closed / "Cancel" clicked before we answered -> stop Claude.
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) ctrl.abort(); });
    return deps.queue.run<{ greeting: string }>(helloTask(language), ctrl.signal);
  });

  app.post('/api/llm/open-login', async () => {
    if (!deps.provider.openLogin) throw new AppError('BAD_REQUEST', 'provider has no sign-in window');
    deps.provider.openLogin();
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
    store: deps.vacancyStore, source: deps.vacancySource, queue: deps.queue, job: deps.searchJob, logger: deps.logger,
    profile: () => deps.profileStore.get(), language: () => deps.settings.get().language ?? 'en',
  });

  await registerApplicationRoutes(app, {
    store: deps.applicationStore, job: deps.applicationJob, printer: deps.printer, vacancies: deps.vacancyStore,
    files: deps.profileFiles, profile: () => deps.profileStore.get(), logger: deps.logger,
  });

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
