import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { NachweisSetup, Profile } from '@bp/shared';
import { AppError } from '../errors.js';
import { recognizeForm } from '../nachweis/build.js';
import { removeQuietly } from './files.js';
import type { ProfileRouteDeps } from './routes.js';
import { NACHWEIS_SETUP_BODY } from './schema.js';
import { receiveUpload } from './upload.js';
import { toView } from './view.js';

/**
 * The Bewerbungsnachweis setup in the profile (0.15.0): who the proof goes to, and which blank form. Entered once,
 * edited with "Edit"; it travels with backups and the transfer file like the rest of the profile.
 */
type SetupBody = Pick<NachweisSetup, 'audience' | 'personName' | 'measure' | 'office'>;

const notSetUp = () => new AppError('NACHWEIS_NOT_SET_UP', 'no Bewerbungsnachweis setup yet');

function trimmed(b: SetupBody): SetupBody {
  return {
    audience: b.audience,
    personName: b.personName.trim(),
    measure: b.measure && { provider: b.measure.provider.trim(), name: b.measure.name.trim(), entry: b.measure.entry, exit: b.measure.exit, advisor: b.measure.advisor.trim() },
    office: b.office && { name: b.office.name.trim(), customerNumber: b.office.customerNumber.trim(), advisor: b.office.advisor.trim() },
  };
}

const ownFile = (p: Profile) => (p.nachweis?.blank.kind === 'own' ? p.nachweis.blank.file : null);

export async function registerNachweisProfileRoutes(app: FastifyInstance, d: ProfileRouteDeps & { now?: () => Date }): Promise<void> {
  const now = () => (d.now?.() ?? new Date()).toISOString();

  app.put('/api/profile/nachweis', { schema: { body: NACHWEIS_SETUP_BODY } }, async (req) => {
    const body = trimmed(req.body as SetupBody);
    const before = d.store.get().nachweis;
    // An own blank is a measure's form: switching to Jobcenter/Agentur goes back to the standard form.
    const keepOwn = before?.blank.kind === 'own' && body.audience === 'measure';
    const profile = d.store.update((p) => {
      p.nachweis = { ...body, blank: keepOwn ? before!.blank : { kind: 'standard' }, updatedAt: now() };
    });
    if (before?.blank.kind === 'own' && !keepOwn) removeQuietly(d.files, before.blank.file, d.logger);
    return toView(profile);
  });

  app.post('/api/profile/nachweis/blank', async (req) => {
    const setup = d.store.get().nachweis;
    if (!setup) throw notSetUp();
    if (setup.audience !== 'measure') throw new AppError('BAD_REQUEST', 'an own blank is only for a measure', 'nachweisFormAudience');
    const stored = await receiveUpload(req, d.files, 'nachweisBlank');
    let profile: Profile;
    const old = ownFile(d.store.get());
    try {
      const form = await recognizeForm(await fs.promises.readFile(d.files.pathOf(stored)));
      if (!form) throw new AppError('NACHWEIS_FORM_UNKNOWN', 'the uploaded docx is not a known Nachweis form');
      profile = d.store.update((p) => {
        if (!p.nachweis) throw notSetUp();
        if (p.nachweis.audience !== 'measure') throw new AppError('BAD_REQUEST', 'an own blank is only for a measure', 'nachweisFormAudience');
        p.nachweis.blank = { kind: 'own', file: stored, form };
        p.nachweis.updatedAt = now();
      });
    } catch (err) {
      // Not referenced by the profile: safe to delete.
      d.files.remove(stored);
      throw err;
    }
    if (old) removeQuietly(d.files, old, d.logger);
    return toView(profile);
  });

  app.delete('/api/profile/nachweis/blank', async () => {
    const before = d.store.get();
    if (!before.nachweis) throw notSetUp();
    const old = ownFile(before);
    const profile = d.store.update((p) => {
      p.nachweis!.blank = { kind: 'standard' };
      p.nachweis!.updatedAt = now();
    });
    if (old) removeQuietly(d.files, old, d.logger);
    return toView(profile);
  });
}
