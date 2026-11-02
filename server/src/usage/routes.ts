import type { FastifyInstance } from 'fastify';
import type { Language } from '@bp/shared';
import type { SettingsStore } from '../data/settings.js';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';

const TIMEOUT_MS = 10_000;

export interface UsageRouteDeps {
  settings: SettingsStore;
  version: string;
  /** Base URL of our cloud service. */
  url: string;
  fetch?: typeof fetch;
  logger: Logger;
}

const feedbackSchema = {
  type: 'object', additionalProperties: false, required: ['kind', 'email', 'text'],
  properties: {
    kind: { type: 'string', enum: ['problem', 'idea'] },
    email: { type: 'string', maxLength: 254 },
    text: { type: 'string', minLength: 1, maxLength: 5000 },
  },
} as const;

export async function registerUsageRoutes(app: FastifyInstance, d: UsageRouteDeps): Promise<void> {
  const fetchFn = d.fetch ?? fetch;

  app.post('/api/feedback', {
    // Fastify's Ajv strips unknown keys; here they are refused instead (same as POST /api/updates/dismiss).
    preValidation: async (req) => {
      const b = req.body;
      if (b && typeof b === 'object' && Object.keys(b).some((k) => k !== 'kind' && k !== 'email' && k !== 'text')) {
        throw new AppError('BAD_REQUEST', 'only { kind, email, text } is accepted');
      }
    },
    schema: { body: feedbackSchema },
  }, async (req, reply) => {
    const b = req.body as { kind: string; email: string; text: string };
    const s = d.settings.get();
    const language: Language = s.language ?? 'en';
    let res: Response;
    try {
      // Works whatever the usage ping setting says: the person is writing to us on purpose.
      res = await fetchFn(`${d.url}/v1/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installId: s.usage.installId, version: d.version, language, email: b.email, kind: b.kind, text: b.text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      d.logger.warn('feedback_failed', { reason: 'offline', message: err instanceof Error ? err.name : 'unknown' });
      throw new AppError('FEEDBACK_FAILED', 'offline', 'offline');
    }
    if (res.ok) return reply.code(204).send();
    const limit = res.status === 429;
    d.logger.warn('feedback_failed', { reason: limit ? 'limit' : 'server', status: res.status });
    throw new AppError('FEEDBACK_FAILED', `${limit ? 'limit' : 'server'} (HTTP ${res.status})`, limit ? 'limit' : 'server');
  });
}
