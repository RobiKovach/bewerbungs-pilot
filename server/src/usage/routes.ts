import type { FastifyInstance } from 'fastify';
import type { Language } from '@bp/shared';
import type { SettingsStore } from '../data/settings.js';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';

const TIMEOUT_MS = 10_000;
const MAX_TEXT = 5000;
// Same as cloud/src/validate.ts: one @, no spaces or control characters, a dot in the domain.
const EMAIL = /^[^s@p{Cc}]+@[^s@p{Cc}]+.[^s@p{Cc}]+$/u;

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
    // The same rules as the cloud service: a typo is told here, not as a service error.
    const email = b.email.trim();
    if (!EMAIL.test(email) || b.text.trim() === '' || Array.from(b.text).length > MAX_TEXT) throw new AppError('BAD_REQUEST', 'invalid email or text');
    const s = d.settings.get();
    const language: Language = s.language ?? 'en';
    let res: Response;
    try {
      // Works whatever the usage ping setting says: the person is writing to us on purpose.
      res = await fetchFn(`${d.url}/v1/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installId: s.usage.installId, version: d.version, language, email, kind: b.kind, text: b.text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new AppError('FEEDBACK_FAILED', 'offline', 'offline');
    }
    if (res.ok) return reply.code(204).send();
    const limit = res.status === 429;
    throw new AppError('FEEDBACK_FAILED', `${limit ? 'limit' : 'server'} (HTTP ${res.status})`, limit ? 'limit' : 'server');
  });
}
