import type { FastifyInstance } from 'fastify';
import type { UpdatesView } from '@bp/shared';
import type { SettingsStore } from '../data/settings.js';
import { AppError } from '../errors.js';
import type { AvailableUpdate } from './checker.js';
import { isNewer } from './version-file.js';

export interface UpdateRouteDeps {
  settings: SettingsStore;
  version: string;
  /** What the daily check found (UpdateChecker.available in production). */
  available: () => AvailableUpdate | null;
}

const dismissSchema = {
  type: 'object', additionalProperties: false, required: ['version'],
  properties: { version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$', maxLength: 32 } },
} as const;

export async function registerUpdateRoutes(app: FastifyInstance, d: UpdateRouteDeps): Promise<void> {
  app.get('/api/updates', async (): Promise<UpdatesView> => {
    const s = d.settings.get();
    const a = d.available();
    // Switched off, nothing newer, or "×" clicked for exactly this version: no banner.
    if (!s.updates.check || !a || !isNewer(a.version, d.version) || a.version === s.updates.dismissedVersion) {
      return { current: d.version, available: null };
    }
    const notes = a.notes[s.language ?? 'en'] ?? a.notes.en ?? '';
    return { current: d.version, available: { version: a.version, url: a.url, notes } };
  });

  app.post('/api/updates/dismiss', {
    // Fastify's Ajv strips unknown keys; here they are refused instead (same as POST /api/llm/install).
    preValidation: async (req) => {
      const b = req.body;
      if (b && typeof b === 'object' && Object.keys(b).some((k) => k !== 'version')) throw new AppError('BAD_REQUEST', 'only { version } is accepted');
    },
    schema: { body: dismissSchema },
  }, async (req, reply) => {
    d.settings.dismissUpdate((req.body as { version: string }).version);
    return reply.code(204).send();
  });
}
