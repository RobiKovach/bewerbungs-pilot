import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Language, ManualEdit, ManualInput, ManualNotice, Profile, Vacancy, VacancyStatus, VacancyView } from '@bp/shared';
import { AppError } from '../errors.js';
import { abortOnClose } from '../http.js';
import type { LlmQueue } from '../llm/queue.js';
import type { Logger } from '../log.js';
import type { Activity } from '../runtime/activity.js';
import { findDuplicate } from './dedup.js';
import { VACANCY_LIMITS } from './schema.js';
import type { SearchJob } from './search-job.js';
import { jobdetailRefnr } from './sources/arbeitsagentur.js';
import { isPdfPath, MAX_STORED_TEXT, noteUrls, readLinkPdf, readNotePdfs, withPdfBlocks } from './pdf-links.js';
import type { PageReader } from './sources/page-reader.js';
import type { PdfFetcher } from './sources/pdf-fetch.js';
import type { SourceDetails, VacancySource } from './sources/types.js';
import type { VacancyStore } from './store.js';
import { extractManualTask, MANUAL_TEXT_MAX, MANUAL_TEXT_MIN, toManualFields, type ManualOutput } from './tasks/extract-manual.js';
import { NOTE_LABEL, scoreTask, toScore, toScores, type ScoreOutput } from './tasks/score.js';

export interface VacancyRouteDeps {
  store: VacancyStore; source: VacancySource; pageReader: PageReader; pdfFetcher: PdfFetcher; queue: LlmQueue; job: SearchJob; logger: Logger; activity: Activity;
  profile: () => Profile; language: () => Language;
}

const L = VACANCY_LIMITS;
/** One download budget for the note's PDF links, and the most a whole "add by link" may wait for links (spec 0.9.1, A3). */
const PDF_BUDGET_MS = 25_000;
const MANUAL_ADD_BUDGET_MS = 60_000;
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
        type: 'object', additionalProperties: false, required: ['email', 'salutation', 'name', 'phone', 'street', 'postcode', 'city'],
        properties: {
          email: { type: 'string', maxLength: L.email }, salutation: { enum: ['', 'Frau', 'Herr'] }, name: { type: 'string', maxLength: L.name },
          phone: { type: 'string', maxLength: L.phone }, street: { type: 'string', maxLength: L.street },
          postcode: { type: 'string', maxLength: L.postcode }, city: { type: 'string', maxLength: L.city },
        },
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
  if (d.partnerUrl) v.partnerUrl = d.partnerUrl;
  else delete v.partnerUrl;
}

export async function registerVacancyRoutes(app: FastifyInstance, d: VacancyRouteDeps): Promise<void> {
  const view = (vacancy: Vacancy): VacancyView => ({ vacancy });
  const duplicateError = (existing: Vacancy) => new AppError('VACANCY_DUPLICATE', existing.id, undefined, { id: existing.id });

  app.get('/api/vacancies', async () => ({ vacancies: d.store.list() }));

  app.get('/api/vacancies/search', async () => d.job.state());

  app.post('/api/vacancies/search', async (_req, reply) => {
    d.activity.refuseDuringRestore();
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
    const language = d.language();
    const task = scoreTask([{ id, title: v.title, company: v.company, locations: v.locations, remote: v.remote, employment: v.employment, salaryText: v.salaryText, text, ...(v.initiative ? { initiative: true } : {}) }], d.profile(), language);
    const r = await d.queue.runTagged<ScoreOutput>(task, abortOnClose(reply));
    const score = toScores(r.value, [id], new Date().toISOString(), r.provider, language).get(id);
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
        url: found.url, contact: null, scoreState: 'failed', score: null, ...(found.partnerUrl ? { partnerUrl: found.partnerUrl } : {}),
      };
      // A short text next to the link is the person's note: it goes in front of the offer text (scored and stored).
      // Longer pasted text is ignored here — the API's own text is the offer.
      const note = text.length < MANUAL_TEXT_MIN ? text : '';
      const offerText = note ? `${NOTE_LABEL} ${note}\n\n${found.text}` : found.text;
      const language = d.language();
      const r = await d.queue.runTagged<ScoreOutput>(scoreTask([{ ...card, text: offerText }], d.profile(), language), signal);
      const score = toScores(r.value, [card.id], new Date().toISOString(), r.provider, language).get(card.id);
      // Re-check right before adding: the Claude call above waits in the shared queue (behind a running
      // search's batches, potentially minutes), and that search is quite likely to add this very offer
      // in the meantime. Without this, both cards would land in the store with the same sourceId.
      const raceTwin = findDuplicate(d.store.list(), found);
      if (raceTwin) throw duplicateError(raceTwin);
      return view(d.store.add({ ...card, score: score ?? null, scoreState: score ? 'scored' : 'failed' }, offerText));
    }

    // A link without (enough) pasted text: the app opens the page itself; pasted text always wins (spec, section 6a).
    // A short text next to the link is the person's note (e.g. which position on the page, or "Initiativbewerbung"):
    // the AI gets it with the page, and the card keeps it in front of the page text.
    let offerText = text;
    let note = '';
    let stored = rawText;
    let notices: ManualNotice[] = [];
    if (text.length < MANUAL_TEXT_MIN && url) {
      // No AI helper chosen: say so now, not after reading the page for up to 25 s.
      d.queue.current();
      const started = Date.now();
      offerText = await readLink(url, signal);
      note = text;
      // PDF links in the note (spec 0.9.1, A2) share one budget, so adding a card never waits much over a minute.
      const urls = note ? noteUrls(note, url) : [];
      const budget = Math.min(PDF_BUDGET_MS, MANUAL_ADD_BUDGET_MS - (Date.now() - started));
      const pdfs = urls.length ? await readNotePdfs(d.pdfFetcher, urls, signal, budget) : { blocks: [], notices: [] };
      notices = pdfs.notices;
      const combined = withPdfBlocks(offerText, pdfs.blocks);
      offerText = combined.forAi;
      stored = note ? `${NOTE_LABEL} ${note}\n\n${combined.stored}` : combined.stored;
    } else if (text.length < MANUAL_TEXT_MIN) {
      throw new AppError('BAD_REQUEST', `pasted text has ${text.length} characters`, 'pastedTooShort', { min: MANUAL_TEXT_MIN });
    }
    const language = d.language();
    const { value: out, provider } = await d.queue.runTagged<ManualOutput>(extractManualTask(offerText, d.profile(), language, note), signal);
    const { initiative, ...fields } = toManualFields(out, note ? `${note}\n${offerText}` : offerText);
    if ((!out.isVacancy && !initiative) || !fields.title) throw new AppError('NOT_A_VACANCY', 'the AI helper found no job offer in the pasted text');
    const twin = findDuplicate(d.store.list(), { sourceId: null, title: fields.title, company: fields.company });
    if (twin) throw duplicateError(twin);
    const added = view(d.store.add({
      ...base, ...fields, ...(initiative ? { initiative: true } : {}), source: 'manual', sourceId: null, publishedAt: '', url, scoreState: 'scored',
      score: toScore(out, new Date().toISOString(), provider, language),
    }, stored));
    return notices.length ? { ...added, notices } : added;
  });

  /**
   * The text behind the link field: a link ending in .pdf is downloaded as a PDF; any other link is opened in the
   * browser, and only if that page cannot be read is the link tried once as a PDF (servers that send a PDF without
   * the extension). A PDF that is a scan → `pdfNoText`; otherwise the page reader's own error.
   */
  async function readLink(url: string, signal: AbortSignal): Promise<string> {
    if (isPdfPath(url)) {
      const text = await readLinkPdf(d.pdfFetcher, url, signal);
      if (text === null) throw new AppError('BAD_REQUEST', 'pdf link not readable', 'pageUnreadable');
      return text.slice(0, MAX_STORED_TEXT);
    }
    try {
      const page = await d.pageReader.read(url, signal);
      // The browser reader refuses (and logs) a too short page itself; this only guards other readers.
      if (page.length < MANUAL_TEXT_MIN) throw new AppError('BAD_REQUEST', `page text has ${page.length} characters`, 'pageUnreadable');
      return page;
    } catch (err) {
      if (!(err instanceof AppError && err.reason === 'pageUnreadable')) throw err;
      const text = await readLinkPdf(d.pdfFetcher, url, signal);
      if (text === null) throw err;
      return text.slice(0, MAX_STORED_TEXT);
    }
  }
}
