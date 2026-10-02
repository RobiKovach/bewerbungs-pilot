import fs from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DocLanguage, LetterPatch, Profile } from '@bp/shared';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';
import type { ProfileFiles } from '../profile/files.js';
import { VACANCY_ID } from '../vacancies/schema.js';
import type { VacancyStore } from '../vacancies/store.js';
import { touchDraft, type ApplicationJob } from './job.js';
import { detectLanguage, englishBelowB2 } from './language.js';
import { bundlePdfs, countPages, type BundlePart, type PdfPrinter } from './pdf.js';
import { packageReadiness } from './readiness.js';
import { cvHtml } from './render/cv.js';
import { asciiName, fileNames } from './render/html.js';
import { letterHtml } from './render/letter.js';
import { APPLICATION_ID, PACKAGE_LIMITS as L } from './schema.js';
import type { ApplicationStore } from './store.js';
import { toListView, toView } from './views.js';

export interface ApplicationRouteDeps {
  store: ApplicationStore; job: ApplicationJob; printer: PdfPrinter; vacancies: VacancyStore; files: ProfileFiles;
  profile: () => Profile; logger: Logger; now?: () => Date;
}

/** Offer texts shorter than this are stubs (the full text is on a partner site): the dialog warns. */
export const SHORT_TEXT = 600;

const LANGUAGE = { enum: ['de', 'en'] };
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: APPLICATION_ID.source } } };
const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'";
const fileParams = {
  type: 'object', required: ['id', 'fileId'],
  properties: { id: { type: 'string', pattern: APPLICATION_ID.source }, fileId: { type: 'string', pattern: '^[0-9a-f-]{36}$' } },
};

function sendHtml(reply: FastifyReply, html: string) {
  return reply.header('X-Frame-Options', 'SAMEORIGIN').header('Content-Security-Policy', PREVIEW_CSP)
    .type('text/html; charset=utf-8').send(html);
}
function sendPdf(reply: FastifyReply, data: Buffer, name: string) {
  return reply.type('application/pdf').header('Content-Disposition', `attachment; filename="${name}"`).send(data);
}

const newQuery = { type: 'object', required: ['vacancyId'], properties: { vacancyId: { type: 'string', pattern: VACANCY_ID.source } } };
const createBody = { type: 'object', additionalProperties: false, required: ['vacancyId', 'language'], properties: { vacancyId: { type: 'string', pattern: VACANCY_ID.source }, language: LANGUAGE } };
const languageBody = { type: 'object', additionalProperties: false, required: ['language'], properties: { language: LANGUAGE } };
const reviseBody = { type: 'object', additionalProperties: false, required: ['instruction'], properties: { instruction: { type: 'string', minLength: 1, maxLength: L.instruction, pattern: '\\S' } } };
const refreshBody = { type: 'object', additionalProperties: false, required: ['keepProfil'], properties: { keepProfil: { type: 'boolean' } } };
const line = (max: number) => ({ type: 'string', maxLength: max });
const letterBody = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    recipient: { type: 'array', maxItems: L.recipientLines, items: line(L.line) },
    subject: { type: 'string', minLength: 1, maxLength: L.subject },
    salutation: line(L.salutation),
    paragraphs: { type: 'array', minItems: L.paragraphsMin, maxItems: L.paragraphsMax, items: { type: 'string', minLength: 1, maxLength: L.paragraph } },
    closing: line(L.closing),
    signature: line(L.signature),
  },
};
const profilBody = { type: 'object', additionalProperties: false, required: ['profil'], properties: { profil: line(L.profil) } };
const attachmentsBody = { type: 'object', additionalProperties: false, required: ['ids'], properties: { ids: { type: 'array', maxItems: L.attachments, uniqueItems: true, items: { type: 'string', maxLength: 64 } } } };

export async function registerApplicationRoutes(app: FastifyInstance, d: ApplicationRouteDeps): Promise<void> {
  const now = d.now ?? (() => new Date());
  const view = (id: string) => toView(d.store.require(id), d.profile());
  const notBusy = (id: string) => {
    if (d.job.busyWith(id)) throw new AppError('CONFLICT', 'a job is working on this package', 'packageBusy');
  };
  const pagesOf = async (id: string) => countPages(await d.printer.print(letterHtml(d.store.require(id), now())));

  app.get('/api/applications', async () => toListView(d.store, d.profile()));

  app.get('/api/applications/new', { schema: { querystring: newQuery } }, async (req) => {
    const { vacancyId } = req.query as { vacancyId: string };
    const v = d.vacancies.require(vacancyId);
    const text = d.vacancies.readText(v.id) ?? '';
    const profile = d.profile();
    return {
      suggestedLanguage: detectLanguage(`${v.title}\n${text}`),
      englishBelowB2: englishBelowB2(profile.sections.languages.data.items),
      shortText: text.trim().length < SHORT_TEXT,
      existingId: d.store.byVacancy(v.id)?.id ?? null,
      readiness: packageReadiness(profile),
    };
  });

  app.get('/api/applications/readiness', async () => packageReadiness(d.profile()));

  app.get('/api/applications/job', async () => d.job.state());

  app.post('/api/applications/job/cancel', async () => {
    d.job.cancel();
    await d.job.whenIdle();
    return d.job.state();
  });

  app.post('/api/applications', { schema: { body: createBody } }, async (req, reply) => {
    const { vacancyId, language } = req.body as { vacancyId: string; language: DocLanguage };
    return reply.code(202).send(d.job.start({ kind: 'create', vacancyId, language }));
  });

  app.get('/api/applications/:id', { schema: { params: idParams } }, async (req) => view((req.params as { id: string }).id));

  app.patch('/api/applications/:id/letter', { schema: { params: idParams, body: letterBody } }, async (req) => {
    const { id } = req.params as { id: string };
    notBusy(id);
    const patch = req.body as LetterPatch;
    const draft = d.store.require(id);
    draft.letter = { ...draft.letter, ...patch };
    // A hand edit is never lost because no browser is installed: pages 0 = "not counted" (approve recounts).
    let counted = 0;
    try {
      counted = await countPages(await d.printer.print(letterHtml(draft, now())));
    } catch {
      // Any print failure (no browser, browser crash, timeout): keep the edit, count again at approve.
    }
    notBusy(id);
    d.store.update(id, (p) => { p.letter = { ...p.letter, ...patch, pages: counted }; touchDraft(p, now()); });
    return view(id);
  });

  app.patch('/api/applications/:id/cv-profil', { schema: { params: idParams, body: profilBody } }, async (req) => {
    const { id } = req.params as { id: string };
    notBusy(id);
    const { profil } = req.body as { profil: string };
    d.store.update(id, (p) => { p.cv.profil = profil; p.cv.profilEditedByHand = true; touchDraft(p, now()); });
    return view(id);
  });

  app.patch('/api/applications/:id/attachments', { schema: { params: idParams, body: attachmentsBody } }, async (req) => {
    const { id } = req.params as { id: string };
    notBusy(id);
    const { ids } = req.body as { ids: string[] };
    const current = d.store.require(id);
    const allowed = new Set([...d.profile().documents.map((doc) => doc.id), ...current.attachments]);
    const unknown = ids.filter((x) => !allowed.has(x));
    if (unknown.length > 0) throw new AppError('BAD_REQUEST', `${unknown.length} unknown document id(s)`);
    d.store.update(id, (p) => { p.attachments = ids; touchDraft(p, now()); });
    return view(id);
  });

  app.post('/api/applications/:id/revise', { schema: { params: idParams, body: reviseBody } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { instruction } = req.body as { instruction: string };
    return reply.code(202).send(d.job.start({ kind: 'revise', applicationId: id, instruction: instruction.trim() }));
  });

  app.post('/api/applications/:id/refresh-cv', { schema: { params: idParams, body: refreshBody } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { keepProfil } = req.body as { keepProfil: boolean };
    return reply.code(202).send(d.job.start({ kind: 'refreshCv', applicationId: id, keepProfil }));
  });

  app.post('/api/applications/:id/recreate', { schema: { params: idParams, body: languageBody } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { language } = req.body as { language: DocLanguage };
    return reply.code(202).send(d.job.start({ kind: 'recreate', applicationId: id, language }));
  });

  app.post('/api/applications/:id/approve', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    notBusy(id);
    // Always recount: the stored number may be stale or 0 ("not counted").
    const pages = await pagesOf(id);
    notBusy(id);
    if (pages !== 1) {
      d.store.update(id, (p) => { p.letter.pages = pages; });
      throw new AppError('LETTER_TOO_LONG', `${pages} pages`);
    }
    d.store.update(id, (p) => { p.letter.pages = 1; p.status = 'approved'; p.approvedAt = now().toISOString(); p.updatedAt = now().toISOString(); });
    return view(id);
  });

  app.post('/api/applications/:id/unapprove', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    notBusy(id);
    d.store.update(id, (p) => touchDraft(p, now()));
    return view(id);
  });

  app.delete('/api/applications/:id', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    notBusy(id);
    d.store.remove(id);
    return { ok: true };
  });

  const photoOf = (id: string) => {
    const file = d.store.photoPath(id);
    return file ? { data: fs.readFileSync(file), ext: file.endsWith('.png') ? '.png' as const : '.jpg' as const } : null;
  };
  const names = (id: string) => { const p = d.store.require(id); return fileNames(p.snapshot.personal.fullName, p.vacancy.company); };
  /** Chosen attachments that still exist in the profile, with their files (spec, section 5: deleted ones are left out). */
  const chosenDocs = (id: string) => {
    const p = d.store.require(id);
    return d.profile().documents.filter((doc) => p.attachments.includes(doc.id) && d.files.exists(doc));
  };

  app.get('/api/applications/:id/preview/letter', { schema: { params: idParams } }, async (req, reply) =>
    sendHtml(reply, letterHtml(d.store.require((req.params as { id: string }).id), now())));

  app.get('/api/applications/:id/preview/cv', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return sendHtml(reply, cvHtml(d.store.require(id), photoOf(id)));
  });

  app.get('/api/applications/:id/pdf/letter', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return sendPdf(reply, await d.printer.print(letterHtml(d.store.require(id), now())), names(id).letter);
  });

  app.get('/api/applications/:id/pdf/cv', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return sendPdf(reply, await d.printer.print(cvHtml(d.store.require(id), photoOf(id))), names(id).cv);
  });

  app.get('/api/applications/:id/pdf/attachment/:fileId', { schema: { params: fileParams } }, async (req, reply) => {
    const { id, fileId } = req.params as { id: string; fileId: string };
    const doc = chosenDocs(id).find((x) => x.id === fileId);
    if (!doc) throw new AppError('NOT_FOUND', `attachment ${fileId}`);
    return sendPdf(reply, fs.readFileSync(d.files.pathOf(doc)), `${asciiName(doc.label || doc.originalName.replace(/\.pdf$/i, '')) || 'Anlage'}.pdf`);
  });

  app.get('/api/applications/:id/pdf/bundle', { schema: { params: idParams } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = d.store.require(id);
    const parts: BundlePart[] = [
      { name: 'letter', data: await d.printer.print(letterHtml(p, now())) },
      { name: 'cv', data: await d.printer.print(cvHtml(p, photoOf(id))) },
      ...chosenDocs(id).map((doc) => ({ name: doc.label || doc.originalName, data: fs.readFileSync(d.files.pathOf(doc)) })),
    ];
    return sendPdf(reply, await bundlePdfs(parts), names(id).bundle);
  });
}
