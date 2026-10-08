import fs from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DocLanguage, LetterPatch, OutcomeStatus, Profile } from '@bp/shared';
import type { SettingsStore } from '../data/settings.js';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';
import { applicationEmail } from '../mail/compose.js';
import type { Mailer } from '../mail/mailer.js';
import type { SecretStore } from '../mail/secret.js';
import type { ProfileFiles } from '../profile/files.js';
import { VACANCY_ID } from '../vacancies/schema.js';
import type { VacancyStore } from '../vacancies/store.js';
import { touchDraft, type ApplicationJob } from './job.js';
import { addStatus, assertEditable, canUndo, dateToIso, isFrozen, undoLast } from './status.js';
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
  profile: () => Profile; logger: Logger; settings: SettingsStore; mailer: Mailer; secrets: SecretStore; now?: () => Date;
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
const refreshBody = { type: 'object', additionalProperties: false, required: ['keepProfil'], properties: { keepProfil: { type: 'boolean' }, keepHeadline: { type: 'boolean' } } };
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
const headlineBody = { type: 'object', additionalProperties: false, required: ['headline'], properties: { headline: { type: 'string', minLength: 1, maxLength: L.headline } } };
const statusBody = {
  type: 'object', additionalProperties: false, required: ['status', 'date'],
  properties: { status: { enum: ['interview', 'rejected', 'offer', 'withdrawn'] }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, note: { type: 'string', maxLength: L.note } },
};
const sendBody = {
  type: 'object', additionalProperties: false, required: ['to', 'subject', 'body'],
  properties: {
    to: { type: 'string', maxLength: L.address, pattern: '^[^\\s@<>,;"]+@[^\\s@<>,;"]+\\.[^\\s@<>,;"]+$' },
    subject: { type: 'string', minLength: 1, maxLength: L.emailSubject, pattern: '^[^\\r\\n]*\\S[^\\r\\n]*$' },
    body: { type: 'string', minLength: 1, maxLength: L.emailBody, pattern: '\\S' },
  },
};
const attachmentsBody = { type: 'object', additionalProperties: false, required: ['ids'], properties: { ids: { type: 'array', maxItems: L.attachments, uniqueItems: true, items: { type: 'string', maxLength: 64 } } } };

export async function registerApplicationRoutes(app: FastifyInstance, d: ApplicationRouteDeps): Promise<void> {
  const now = d.now ?? (() => new Date());
  const view = (id: string) => toView(d.store.require(id), d.profile());
  const editable = (id: string) => assertEditable(d.store.require(id));
  /** Packages with an email in flight: nothing may change them until SMTP answers. */
  const sending = new Set<string>();
  const notBusy = (id: string) => {
    if (sending.has(id)) throw new AppError('CONFLICT', 'this package is being sent', 'packageSending');
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
    editable(id);
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
    editable(id);
    notBusy(id);
    const { profil } = req.body as { profil: string };
    d.store.update(id, (p) => { p.cv.profil = profil; p.cv.profilEditedByHand = true; touchDraft(p, now()); });
    return view(id);
  });

  app.patch('/api/applications/:id/cv-headline', { schema: { params: idParams, body: headlineBody } }, async (req) => {
    const { id } = req.params as { id: string };
    editable(id);
    notBusy(id);
    const { headline } = req.body as { headline: string };
    if (headline.trim() === '') throw new AppError('BAD_REQUEST', 'headline is empty');
    d.store.update(id, (p) => { p.cv.headline = headline.trim(); p.cv.headlineEditedByHand = true; touchDraft(p, now()); });
    return view(id);
  });

  app.patch('/api/applications/:id/attachments', { schema: { params: idParams, body: attachmentsBody } }, async (req) => {
    const { id } = req.params as { id: string };
    editable(id);
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
    notBusy(id);
    return reply.code(202).send(d.job.start({ kind: 'revise', applicationId: id, instruction: instruction.trim() }));
  });

  app.post('/api/applications/:id/refresh-cv', { schema: { params: idParams, body: refreshBody } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { keepProfil, keepHeadline } = req.body as { keepProfil: boolean; keepHeadline?: boolean };
    notBusy(id);
    return reply.code(202).send(d.job.start({ kind: 'refreshCv', applicationId: id, keepProfil, keepHeadline: keepHeadline ?? false }));
  });

  app.post('/api/applications/:id/recreate', { schema: { params: idParams, body: languageBody } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { language } = req.body as { language: DocLanguage };
    notBusy(id);
    return reply.code(202).send(d.job.start({ kind: 'recreate', applicationId: id, language }));
  });

  app.post('/api/applications/:id/approve', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    editable(id);
    notBusy(id);
    // Always recount: the stored number may be stale or 0 ("not counted").
    const pages = await pagesOf(id);
    notBusy(id);
    if (pages !== 1) {
      d.store.update(id, (p) => { p.letter.pages = pages; });
      throw new AppError('LETTER_TOO_LONG', `${pages} pages`);
    }
    d.store.update(id, (p) => { const at = now().toISOString(); p.letter.pages = 1; addStatus(p, 'approved', at); p.approvedAt = at; });
    return view(id);
  });

  // Re-counts the letter's pages with the current layout (a stored number can be stale after an app update). Only `pages` changes.
  app.post('/api/applications/:id/recount', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    editable(id);
    notBusy(id);
    const pages = await pagesOf(id);
    notBusy(id);
    d.store.update(id, (p) => { p.letter.pages = pages; });
    return view(id);
  });

  app.post('/api/applications/:id/unapprove', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    editable(id);
    notBusy(id);
    d.store.update(id, (p) => touchDraft(p, now()));
    return view(id);
  });

  app.post('/api/applications/:id/submitted', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    notBusy(id);
    if (d.store.require(id).status !== 'approved') throw new AppError('CONFLICT', 'only an approved package can be marked as submitted');
    d.store.update(id, (p) => addStatus(p, 'submitted', now().toISOString()));
    return view(id);
  });

  app.post('/api/applications/:id/status', { schema: { params: idParams, body: statusBody } }, async (req) => {
    const { id } = req.params as { id: string };
    notBusy(id);
    const { status, date, note } = req.body as { status: OutcomeStatus; date: string; note?: string };
    if (!isFrozen(d.store.require(id))) throw new AppError('CONFLICT', 'the package was not sent yet');
    const at = dateToIso(date, now());
    const text = note?.trim();
    d.store.update(id, (p) => { addStatus(p, status, at, text ? { note: text } : {}); p.updatedAt = now().toISOString(); });
    return view(id);
  });

  app.post('/api/applications/:id/status/undo', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    notBusy(id);
    if (!canUndo(d.store.require(id))) throw new AppError('CONFLICT', 'nothing to undo');
    d.store.update(id, (p) => undoLast(p, now().toISOString()));
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
  const names = (id: string) => { const p = d.store.require(id); return fileNames(p.snapshot.personal.fullName, p.vacancy.company, p.language); };
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

  // ---- Sending by email ----
  const docFileName = (doc: { label: string; originalName: string }) => `${asciiName(doc.label || doc.originalName.replace(/\.pdf$/i, '')) || 'Anlage'}.pdf`;
  /** Makes names unique within one email: a repeat gets _2, _3 … before the extension (case-insensitive). */
  const uniqueNames = <T extends { filename: string }>(files: T[]): T[] => {
    const used = new Set<string>();
    return files.map((f) => {
      let name = f.filename;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${f.filename.replace(/\.pdf$/i, '')}_${n}.pdf`;
      used.add(name.toLowerCase());
      return { ...f, filename: name };
    });
  };
  /** The PDFs that would go into the email, freshly printed, with their file names. */
  const mailAttachments = async (id: string) => {
    const p = d.store.require(id);
    const n = fileNames(p.snapshot.personal.fullName, p.vacancy.company, p.language);
    return uniqueNames([
      { filename: n.letter, content: await d.printer.print(letterHtml(p, now())) },
      { filename: n.cv, content: await d.printer.print(cvHtml(p, photoOf(id))) },
      ...chosenDocs(id).map((doc) => ({ filename: docFileName(doc), content: fs.readFileSync(d.files.pathOf(doc)) })),
    ]);
  };

  app.get('/api/applications/:id/send-draft', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params as { id: string };
    const p = d.store.require(id);
    assertEditable(p);
    const email = applicationEmail(p);
    const attachments = (await mailAttachments(id)).map((a) => ({ name: a.filename, size: a.content.length }));
    return {
      to: p.vacancy.contact?.email ?? '', subject: email.subject, body: email.text, attachments,
      totalSize: attachments.reduce((sum, a) => sum + a.size, 0),
      mailReady: d.settings.get().mail !== null && (await d.secrets.load()) !== null,
    };
  });

  app.post('/api/applications/:id/send', { schema: { params: idParams, body: sendBody } }, async (req) => {
    const { id } = req.params as { id: string };
    const { to, subject, body } = req.body as { to: string; subject: string; body: string };
    // Every check and the lock come before the first await: two quick requests can never both pass.
    notBusy(id);
    const start = d.store.require(id);
    assertEditable(start);
    if (start.status !== 'approved') throw new AppError('CONFLICT', 'only an approved package can be sent');
    const config = d.settings.get().mail;
    if (!config) throw new AppError('MAIL_NOT_CONFIGURED', 'no mailbox connected');
    sending.add(id);
    try {
      const password = await d.secrets.load();
      if (password === null) throw new AppError('MAIL_NOT_CONFIGURED', 'no password saved');
      const attachments = await mailAttachments(id);
      // Nothing may have changed the package while it was printed (no await between this check and the send call).
      if (d.job.busyWith(id)) throw new AppError('CONFLICT', 'a job is working on this package', 'packageBusy');
      const current = d.store.require(id);
      if (current.status !== 'approved' || current.updatedAt !== start.updatedAt) throw new AppError('CONFLICT', 'the package changed while it was being prepared', 'packageChanged');
      const { messageId } = await d.mailer.send(config, password, {
        from: { name: config.senderName, address: config.address }, to, bcc: config.address, subject, text: body, attachments,
      });
      const at = now().toISOString();
      d.store.update(id, (p) => {
        if (p.status !== 'approved') throw new AppError('CONFLICT', 'package is no longer approved', 'packageChanged');
        addStatus(p, 'sent', at, { to, messageId });
        p.sentAt = at;
        p.sentEmail = { to, subject, body, attachments: attachments.map((a) => a.filename) };
      });
      d.logger.info('application_sent', { id });
      return view(id);
    } catch (err) {
      d.logger.warn('application_send_failed', { id, code: err instanceof AppError ? err.code : 'UNKNOWN' });
      throw err;
    } finally {
      sending.delete(id);
    }
  });
}
