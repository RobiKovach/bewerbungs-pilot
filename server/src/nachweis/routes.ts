import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { ApplicationPackage, NachweisView, Profile } from '@bp/shared';
import type { ApplicationStore } from '../applications/store.js';
import { APPLICATION_ID } from '../applications/schema.js';
import { addEvent } from '../applications/status.js';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';
import { CONTENT_TYPES, type ProfileFiles } from '../profile/files.js';
import type { Activity } from '../runtime/activity.js';
import type { VacancyStore } from '../vacancies/store.js';
import { buildNachweis } from './build.js';
import { standardBlankPath } from './forms/standard.js';
import { buildRows, isSubmitted, toCandidates } from './rows.js';

/**
 * Bewerbungsnachweis (0.15.0): which submitted applications exist, the filled Word file, and the "exported" marks.
 * Building marks nothing — the page marks only after the file was really saved (POST /mark).
 */
export interface NachweisRouteDeps {
  applications: ApplicationStore;
  vacancies: VacancyStore;
  profile: () => Profile;
  files: ProfileFiles;
  activity: Activity;
  logger: Logger;
  now?: () => Date;
}

const ids = { type: 'array', minItems: 1, maxItems: 500, uniqueItems: true, items: { type: 'string', pattern: APPLICATION_ID.source } };
const buildBody = { type: 'object', additionalProperties: false, required: ['applicationIds'], properties: { applicationIds: ids } };
const markBody = {
  type: 'object', additionalProperties: false, required: ['applicationIds', 'fileName'],
  properties: { applicationIds: ids, fileName: { type: 'string', minLength: 1, maxLength: 200 } },
};

export async function registerNachweisRoutes(app: FastifyInstance, d: NachweisRouteDeps): Promise<void> {
  const vacancy = (id: string) => d.vacancies.get(id);
  const view = (): NachweisView => ({ setup: d.profile().nachweis, candidates: toCandidates(d.applications.all(), vacancy) });
  /** The packages by id; every one must exist and be submitted. */
  const submittedPackages = (applicationIds: string[]): ApplicationPackage[] => applicationIds.map((id) => {
    const p = d.applications.get(id);
    if (!p) throw new AppError('NOT_FOUND', `application ${id}`);
    if (!isSubmitted(p)) throw new AppError('CONFLICT', `application ${id} is not submitted`, 'nachweisNotSubmitted');
    return p;
  });

  app.get('/api/nachweis', async () => view());

  app.post('/api/nachweis/build', { schema: { body: buildBody } }, async (req, reply) => {
    const { applicationIds } = req.body as { applicationIds: string[] };
    d.activity.refuseDuringRestore();
    const setup = d.profile().nachweis;
    if (!setup) throw new AppError('NACHWEIS_NOT_SET_UP', 'no Bewerbungsnachweis setup yet');
    const rows = buildRows(submittedPackages(applicationIds), vacancy);
    const end = d.activity.begin('nachweis');
    let docx: Buffer;
    try {
      const blank = setup.blank.kind === 'own' ? d.files.pathOf(setup.blank.file) : standardBlankPath();
      let buf: Buffer;
      try {
        buf = await fs.promises.readFile(blank);
      } catch (err) {
        if (setup.blank.kind === 'own') throw new AppError('NACHWEIS_FORM_CHANGED', `own blank unreadable: ${(err as NodeJS.ErrnoException).code ?? 'error'}`);
        throw err;
      }
      docx = await buildNachweis(buf, setup.blank.kind === 'own' ? setup.blank.form : 'standard', setup, rows);
    } finally {
      end();
    }
    d.logger.info('nachweis_built', { rows: rows.length, form: setup.blank.kind === 'own' ? setup.blank.form : 'standard' });
    const name = `Bewerbungsnachweis_${rows[0]!.appliedAt}_${rows.at(-1)!.appliedAt}.docx`;
    return reply.type(CONTENT_TYPES['.docx']).header('Content-Disposition', `attachment; filename="${name}"`).send(docx);
  });

  app.post('/api/nachweis/mark', { schema: { body: markBody } }, async (req) => {
    const { applicationIds, fileName } = req.body as { applicationIds: string[]; fileName: string };
    d.activity.refuseDuringRestore();
    submittedPackages(applicationIds);
    const at = (d.now?.() ?? new Date()).toISOString();
    for (const id of applicationIds) {
      d.applications.update(id, (p) => {
        // A mark records where the application went; it is not a change of the package (its updatedAt stays).
        const updatedAt = p.updatedAt;
        addEvent(p, 'nachweis', at, { note: fileName.trim() });
        p.updatedAt = updatedAt;
      });
    }
    return view();
  });
}
