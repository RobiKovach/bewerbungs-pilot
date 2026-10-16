import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Language, ManualEdit, ManualInput, Profile, Vacancy, VacancyStatus, VacancyView } from '@bp/shared';
import { AppError } from '../errors.js';
import { abortOnClose } from '../http.js';
import type { LlmQueue } from '../llm/queue.js';
import type { Logger } from '../log.js';
import { findDuplicate } from './dedup.js';
import { VACANCY_LIMITS } from './schema.js';
import type { SearchJob } from './search-job.js';
import { jobdetailRefnr } from './sources/arbeitsagentur.js';
import type { SourceDetails, VacancySource } from './sources/types.js';
import type { VacancyStore } from './store.js';
import { extractManualTask, MANUAL_TEXT_MAX, MANUAL_TEXT_MIN, toManualFields, type ManualOutput } from './tasks/extract-manual.js';
import { scoreTask, toScore, toScores, type ScoreOutput } from './tasks/score.js';

export interface VacancyRouteDeps {
  store: VacancyStore; source: VacancySource; queue: LlmQueue; job: SearchJob; logger: Logger;
  profile: () => Profile; language: () => Language;
}

const L = VACANCY_LIMITS;
const HTTP_URL = '^(https?://.+)?$';
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' } } };
const statusBody = { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { enum: ['new', 'favorite', 'hidden'] } } };
const editBody = {
  type: 'object', additionalProperties: false, required: ['title', 'company', 'locations', 'url', 'contact'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: L.title },
    company: { type: 'string', maxLength: L.company },
    locations: { type: 'array', maxItems: L.locations, items: { type: 'string', minLength: 1, maxLength: L.location } },
    url: { type: 'string', maxLength: L.url, pattern: HTTP_URL },
    contact: {
      anyOf: [{ type: 'null' }, {
        type: 'object', additionalProperties: false, required: ['email', 'salutation', 'name'],
        properties: { email: { type: 'string', maxLength: L.email }, salutation: { enum: ['', 'Frau', 'Herr'] }, name: { type: 'string', maxLength: L.name } },
      }],
    },
  },
};

const manualBody = {
  type: 'object', additionalProperties: false,
  properties: { text: { type: 'string', maxLength: MANUAL_TEXT_MAX }, url: { type: 'string', maxLength: VACANCY_LIMITS.url, pattern: HTTP_URL } },
};
const isHttpUrl = (s: string) => { try { return ['http:', 'https:'].includes(new URL(s).protocol); } catch { return false; } };

const ALLOWED: Record<VacancyStatus, readonly VacancyStatus[]> = {
  new: ['favorite', 'hidden'],
  favorite: ['new'],
  stale: ['hidden'],
  hidden: ['new'],
};

/** Card fields as the source now describes the offer (used when a compacted card comes back). */
export function refill(v: Vacancy, d: SourceDetails): void {
  v.title = d.title || v.title;
  v.company = d.company || v.company;
  v.locations = d.locations;
  v.remote = d.remote;
  v.employment = d.employment;
  v.salaryText = d.salaryText;
  v.publishedAt = d.publishedAt;
  v.url = d.url;
}

export async function registerVacancyRoutes(app: FastifyInstance, d: VacancyRouteDeps): Promise<void> {
  const view = (vacancy: Vacancy): VacancyView => ({ vacancy });
  const duplicateError = (existing: Vacancy) => new AppError('VACANCY_DUPLICATE', existing.id, undefined, { id: existing.id });

  app.get('/api/vacancies', async () => ({ vacancies: d.store.list() }));

  app.get('/api/vacancies/search', async () => d.job.state());

  app.post('/api/vacancies/search', async (_req, reply) => {
    d.job.start();
    return reply.code(202).send(d.job.state());
  });

  app.post('/api/vacancies/search/stop', async () => {
    d.job.stop();
    await d.job.whenIdle();
    return d.job.state();
  });

  app.get('/api/vacancies/:id/text', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    d.store.require(id);
    return { text: d.store.readText(id) ?? '' };
  });

  app.post('/api/vacancies/:id/text/refresh', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = d.store.require(id);
    if (v.source !== 'arbeitsagentur' || !v.sourceId) throw new AppError('CONFLICT', 'only Arbeitsagentur offers can be reloaded');
    const found = await d.source.details(v.sourceId, abortOnClose(reply));
    if (!found) return view(d.store.update(id, (x) => { if (x.status === 'new') x.status = 'stale'; }));
    d.store.writeText(id, found.text);
    return view(d.store.update(id, (x) => refill(x, found)));
  });

  app.post('/api/vacancies/:id/status', { schema: { params: idParams, body: statusBody } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: VacancyStatus };
    const v = d.store.require(id);
    if (!ALLOWED[v.status].includes(status)) throw new AppError('CONFLICT', `${v.status} → ${status} not allowed`);
    if (status === 'hidden') {
      return view(d.store.update(id, (x) => { x.status = 'hidden'; x.hiddenAt = new Date().toISOString(); }));
    }
    if (v.status === 'hidden' && v.source === 'arbeitsagentur' && v.sourceId && !v.hasText) {
      // Compacted while hidden: the offer's text and fields have to come from the source again.
      const found = await d.source.details(v.sourceId, abortOnClose(reply));
      if (!found) return view(d.store.update(id, (x) => { x.status = 'stale'; x.hiddenAt = null; }));
      d.store.writeText(id, found.text);
      return view(d.store.update(id, (x) => {
        refill(x, found);
        x.status = 'new'; x.hiddenAt = null; x.score = null; x.scoreState = 'notScored';
      }));
    }
    return view(d.store.update(id, (x) => { x.status = status; x.hiddenAt = null; }));
  });

  app.post('/api/vacancies/:id/score', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = d.store.require(id);
    if (v.scoreState === 'pending') throw new AppError('CONFLICT', 'the running search is about to score this card');
    const text = d.store.readText(id);
    // '' is a real, scoreable text (a partner-stub offer whose batch scoring failed) — only a missing
    // text file (readText returns null) means there is nothing to send to Claude.
    if (text === null) throw new AppError('CONFLICT', 'no text to score');
    const task = scoreTask([{ id, title: v.title, company: v.company, locations: v.locations, remote: v.remote, employment: v.employment, salaryText: v.salaryText, text }], d.profile(), d.language());
    const r = await d.queue.runTagged<ScoreOutput>(task, abortOnClose(reply));
    const score = toScores(r.value, [id], new Date().toISOString(), r.provider).get(id);
    return view(d.store.update(id, (x) => { x.score = score ?? x.score; x.scoreState = score ? 'scored' : 'failed'; }));
  });

  app.patch('/api/vacancies/:id', { schema: { params: idParams, body: editBody } }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as ManualEdit;
    if (d.store.require(id).source !== 'manual') throw new AppError('CONFLICT', 'only pasted offers can be edited');
    return view(d.store.update(id, (x) => {
      x.title = body.title.trim(); x.company = body.company.trim(); x.locations = body.locations.map((l) => l.trim());
      x.url = body.url.trim(); x.contact = body.contact;
    }));
  });

  app.post('/api/vacancies/manual', { schema: { body: manualBody } }, async (req, reply) => {
    const signal = abortOnClose(reply);
    const body = req.body as ManualInput;
    const rawText = body.text ?? '';
    const text = rawText.trim();
    const url = (body.url ?? '').trim();
    if (url && !isHttpUrl(url)) throw new AppError('BAD_REQUEST', 'link must be http(s)');
    const now = new Date().toISOString();
    const base = { id: crypto.randomUUID(), addedManually: true, foundAt: now, status: 'new' as const, hiddenAt: null, hasText: false };

    const refnr = url ? jobdetailRefnr(url) : null;
    if (refnr) {
      const known = findDuplicate(d.store.list(), { sourceId: refnr, title: '', company: '' });
      if (known) throw duplicateError(known);
      const found = await d.source.details(refnr, signal);
      if (!found) throw new AppError('VACANCY_NOT_FOUND', `offer ${refnr} is gone`, 'offerGone');
      const twin = findDuplicate(d.store.list(), found);
      if (twin) throw duplicateError(twin);
      const card: Vacancy = {
        ...base, source: 'arbeitsagentur', sourceId: refnr, title: found.title, company: found.company, locations: found.locations,
        remote: found.remote, employment: found.employment, salaryText: found.salaryText, publishedAt: found.publishedAt,
        url: found.url, contact: null, scoreState: 'failed', score: null,
      };
      const r = await d.queue.runTagged<ScoreOutput>(scoreTask([{ ...card, text: found.text }], d.profile(), d.language()), signal);
      const score = toScores(r.value, [card.id], new Date().toISOString(), r.provider).get(card.id);
      // Re-check right before adding: the Claude call above waits in the shared queue (behind a running
      // search's batches, potentially minutes), and that search is quite likely to add this very offer
      // in the meantime. Without this, both cards would land in the store with the same sourceId.
      const raceTwin = findDuplicate(d.store.list(), found);
      if (raceTwin) throw duplicateError(raceTwin);
      return view(d.store.add({ ...card, score: score ?? null, scoreState: score ? 'scored' : 'failed' }, found.text));
    }

    if (text.length < MANUAL_TEXT_MIN) {
      throw new AppError('BAD_REQUEST', `pasted text has ${text.length} characters`, 'pastedTooShort', { min: MANUAL_TEXT_MIN });
    }
    const { value: out, provider } = await d.queue.runTagged<ManualOutput>(extractManualTask(text, d.profile(), d.language()), signal);
    const fields = toManualFields(out, text);
    if (!out.isVacancy || !fields.title) throw new AppError('NOT_A_VACANCY', 'Claude found no job offer in the pasted text');
    const twin = findDuplicate(d.store.list(), { sourceId: null, title: fields.title, company: fields.company });
    if (twin) throw duplicateError(twin);
    return view(d.store.add({
      ...base, ...fields, source: 'manual', sourceId: null, publishedAt: '', url, scoreState: 'scored',
      score: toScore(out, new Date().toISOString(), provider),
    }, rawText));
  });
}
