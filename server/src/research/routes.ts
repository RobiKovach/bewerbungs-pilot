import type { FastifyInstance } from 'fastify';
import type { VacancyView } from '@bp/shared';
import { AppError } from '../errors.js';
import type { Activity } from '../runtime/activity.js';
import { VACANCY_LIMITS } from '../vacancies/schema.js';
import { checkPublicUrl } from '../vacancies/sources/safe-address.js';
import type { VacancyStore } from '../vacancies/store.js';
import { blankResearch, type ResearchJob } from './job.js';

/** Company research routes (0.13.0, spec 3.1/3.3). Starting answers at once (202); the job writes the card later. */

export interface ResearchRouteDeps { store: VacancyStore; job: ResearchJob; activity: Activity }

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' } } };
const factParams = {
  type: 'object', required: ['id', 'factId'],
  properties: { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' }, factId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' } },
};
const hiddenBody = { type: 'object', additionalProperties: false, required: ['hidden'], properties: { hidden: { type: 'boolean' } } };
const websiteBody = {
  type: 'object', additionalProperties: false, required: ['url'],
  properties: { url: { type: 'string', minLength: 1, maxLength: VACANCY_LIMITS.url, pattern: '^https?://.+$' } },
};

/** No lookup here: a name always ends as 'dns', which the page reader's own check then decides (as for pasted links). */
const RESOLVED_BY_READER = async (): Promise<string[]> => { throw new Error('resolved by the page reader'); };

export async function registerResearchRoutes(app: FastifyInstance, d: ResearchRouteDeps): Promise<void> {
  const view = (id: string): VacancyView => ({ vacancy: d.store.require(id) });

  app.post('/api/vacancies/:id/research', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    d.activity.refuseDuringRestore();
    d.job.enqueue(id);
    return reply.code(202).send(view(id));
  });

  app.delete('/api/vacancies/:id/research', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    d.store.require(id);
    d.job.cancel(id);
    return view(id);
  });

  // A fact the person removed is not used in the letter. A new research run brings new facts: `hidden` is not carried.
  app.patch('/api/vacancies/:id/research/facts/:factId', { schema: { params: factParams, body: hiddenBody } }, async (req) => {
    const { id, factId } = req.params as { id: string; factId: string };
    const { hidden } = req.body as { hidden: boolean };
    const v = d.store.require(id);
    if (!v.research?.facts.some((f) => f.id === factId)) throw new AppError('NOT_FOUND', 'no such fact');
    return {
      vacancy: d.store.update(id, (x) => {
        for (const f of x.research?.facts ?? []) {
          if (f.id !== factId) continue;
          if (hidden) f.hidden = true;
          else delete f.hidden;
        }
      }),
    } satisfies VacancyView;
  });

  // The person typed the company's website: it is used without a name check, and a new research starts from it.
  app.put('/api/vacancies/:id/research/website', { schema: { params: idParams, body: websiteBody } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const url = (req.body as { url: string }).url.trim();
    if (d.store.require(id).status === 'hidden') throw new AppError('CONFLICT', 'a hidden card is not researched');
    if (!URL.canParse(url)) throw new AppError('BAD_REQUEST', 'not a link');
    const pre = await checkPublicUrl(url, RESOLVED_BY_READER);
    if (!pre.ok && pre.why !== 'dns') throw new AppError('BAD_REQUEST', `blocked: ${pre.why}`);
    d.activity.refuseDuringRestore();
    const website = new URL(url).origin;
    d.store.update(id, (x) => { x.research = { ...(x.research ?? blankResearch()), website, websiteByPerson: true }; });
    d.job.enqueue(id);
    return reply.code(202).send(view(id));
  });
}
