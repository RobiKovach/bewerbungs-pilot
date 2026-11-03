import type { FastifyInstance } from 'fastify';
import type { UpdatesView } from '@bp/shared';
import type { UpdateProgress } from '@bp/shared';
import type { SettingsStore } from '../data/settings.js';
import { AppError } from '../errors.js';
import type { AvailableUpdate } from './checker.js';
import type { UpdateApplier, UpdateOutcome } from './apply.js';
import { isNewer } from './version-file.js';

export interface UpdateRouteDeps {
  settings: SettingsStore;
  version: string;
  /** What the daily check found (UpdateChecker.available in production). */
  available: () => AvailableUpdate | null;
  /** One-click update (0.11.0); without it every apply answers `noUpdate`. */
  apply?: UpdateApplier;
  /** False in the demo copy: it can show the banner but never install. Default true. */
  installable?: boolean;
  /** What the installer left for this start; handed out once. */
  outcome?: UpdateOutcome;
}

const dismissSchema = {
  type: 'object', additionalProperties: false, required: ['version'],
  properties: { version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$', maxLength: 32 } },
} as const;

export async function registerUpdateRoutes(app: FastifyInstance, d: UpdateRouteDeps): Promise<void> {
  app.get('/api/updates', async (): Promise<UpdatesView> => {
    const s = d.settings.get();
    const a = d.available();
    // Shown once: the first answer after an update (or a failed one) carries it, later ones do not.
    const was = d.outcome?.take() ?? {};
    const view = (v: UpdatesView): UpdatesView => ({ ...v, ...was });
    // Switched off, nothing newer, or "×" clicked for exactly this version: no banner.
    if (!s.updates.check || !a || !isNewer(a.version, d.version) || a.version === s.updates.dismissedVersion) {
      return view({ current: d.version, available: null });
    }
    const notes = a.notes[s.language ?? 'en'] ?? a.notes.en ?? '';
    return view({ current: d.version, available: { version: a.version, url: a.url, notes, canInstall: Boolean(a.sha256) && d.installable !== false } });
  });

  /** Starts "Update now": 202 and the work goes on in the background; 409 updateRunning | noUpdate | busy. */
  app.post('/api/updates/apply', async (_req, reply) => {
    if (!d.apply) throw new AppError('CONFLICT', 'updates not available', 'noUpdate');
    d.apply.apply();
    return reply.code(202).send(d.apply.progress());
  });

  app.get('/api/updates/progress', async (): Promise<UpdateProgress> => d.apply?.progress() ?? { state: 'idle' });

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
