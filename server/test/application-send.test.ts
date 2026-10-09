import { describe, it, expect } from 'vitest';
import type { ApplicationView } from '@bp/shared';
import { AppError } from '../src/errors.js';
import type { Logger } from '../src/log.js';
import { H } from './helpers/app.js';
import { MAIL, MAIL_BODY, type Ctx, post, sendTo, setup, viewOf } from './helpers/sending.js';

describe('send', () => {
  it('sends an approved package: To, BCC to self, From, attachments; marks it sent and frozen', async () => {
    const { ctx, id } = await setup();
    const r = await sendTo(ctx, id);
    expect(r.statusCode).toBe(200);
    expect(ctx.mailer.sent).toHaveLength(1);
    const { mail } = ctx.mailer.sent[0];
    expect(mail).toMatchObject({ to: 'jobs@muster.example', bcc: 'max@example.com', from: { address: 'max@example.com', name: 'Max Mustermann' }, subject: MAIL_BODY.subject, text: MAIL_BODY.body });
    expect(mail.attachments.map((a) => a.filename)).toEqual(['Anschreiben_Max_Mustermann_Muster_GmbH.pdf', 'Lebenslauf_Max_Mustermann.pdf']);
    for (const a of mail.attachments) expect(a.content.subarray(0, 5).toString()).toBe('%PDF-');
    const app = (r.json() as ApplicationView).application;
    expect(app.status).toBe('sent');
    expect(app.sentAt).toEqual(expect.any(String));
    expect(app.history.at(-1)).toMatchObject({ kind: 'sent', to: 'jobs@muster.example', messageId: '<fake-1@example.com>' });
    expect(app.sentEmail).toEqual({ to: 'jobs@muster.example', subject: MAIL_BODY.subject, body: MAIL_BODY.body, attachments: ['Anschreiben_Max_Mustermann_Muster_GmbH.pdf', 'Lebenslauf_Max_Mustermann.pdf'] });
    const edit = await ctx.app.inject({ method: 'PATCH', url: `/api/applications/${id}/letter`, headers: H, payload: { closing: 'x' } });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().error).toMatchObject({ reason: 'packageSent' });
  });

  it('refuses: draft, already sent, mail not connected, bad address, CR/LF — nothing is sent', async () => {
    const draft = await setup({ approve: false });
    expect((await sendTo(draft.ctx, draft.id)).statusCode).toBe(409);

    const none = await setup({ connected: false });
    const r = await sendTo(none.ctx, none.id);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('MAIL_NOT_CONFIGURED');
    none.ctx.settings.setMail(MAIL); // settings but no saved password
    expect((await sendTo(none.ctx, none.id)).json().error.code).toBe('MAIL_NOT_CONFIGURED');

    const { ctx, id } = await setup();
    for (const bad of [
      { ...MAIL_BODY, to: 'jobs@muster.example\r\nBcc: x@y.de' }, { ...MAIL_BODY, subject: 'a\nb' }, { ...MAIL_BODY, to: 'not an address' },
      { ...MAIL_BODY, to: `${'a'.repeat(250)}@muster.example` }, { ...MAIL_BODY, subject: '' }, { ...MAIL_BODY, body: '' }, { ...MAIL_BODY, body: 'x'.repeat(5001) },
    ]) expect((await sendTo(ctx, id, bad)).statusCode).toBe(400);
    expect(ctx.mailer.sent).toHaveLength(0);
    expect((await sendTo(ctx, id)).statusCode).toBe(200);
    expect((await sendTo(ctx, id)).statusCode).toBe(409);
    expect(ctx.mailer.sent).toHaveLength(1);
    expect(draft.ctx.mailer.sent.length + none.ctx.mailer.sent.length).toBe(0);
  });

  it('two quick sends send one email', async () => {
    const { ctx, id } = await setup();
    ctx.mailer.delayMs = 50;
    const [a, b] = await Promise.all([sendTo(ctx, id), sendTo(ctx, id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(ctx.mailer.sent).toHaveLength(1);
    expect((await viewOf(ctx, id)).application.history.filter((h) => h.kind === 'sent')).toHaveLength(1);
  });

  it('a failed send changes nothing, and a retry works afterwards', async () => {
    const { ctx, id } = await setup();
    const before = (await viewOf(ctx, id)).application;
    ctx.mailer.failWith = new AppError('MAIL_REJECTED', 'fake');
    const r = await sendTo(ctx, id);
    expect(r.statusCode).toBe(502);
    expect(r.json().error.code).toBe('MAIL_REJECTED');
    const after = (await viewOf(ctx, id)).application;
    expect(after).toMatchObject({ status: 'approved', sentAt: null, sentEmail: null });
    expect(after.history).toEqual(before.history);
    ctx.mailer.failWith = null;
    expect((await sendTo(ctx, id)).statusCode).toBe(200);
  });

  it('refuses while a job works on the package', async () => {
    const { ctx, id } = await setup();
    ctx.applicationJob.busyWith = (x: string) => x === id;
    const r = await sendTo(ctx, id);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('packageBusy');
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('while the email is in flight, edits, status changes and Claude jobs are refused; the sent package keeps the emailed letter', async () => {
    const { ctx, id } = await setup();
    const letter = (await viewOf(ctx, id)).application.letter;
    ctx.mailer.delayMs = 80;
    const inFlight = sendTo(ctx, id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const attempts = [
      ctx.app.inject({ method: 'PATCH', url: `/api/applications/${id}/letter`, headers: H, payload: { closing: 'Ciao' } }),
      post(ctx, `/api/applications/${id}/submitted`, {}),
      post(ctx, `/api/applications/${id}/unapprove`, {}),
      post(ctx, `/api/applications/${id}/revise`, { instruction: 'kürzer' }),
      post(ctx, `/api/applications/${id}/refresh-cv`, { keepProfil: true }),
      post(ctx, `/api/applications/${id}/recreate`, { language: 'en' }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode).toBe(409);
      expect(res.json().error.reason).toBe('packageSending');
    }
    expect((await inFlight).statusCode).toBe(200);
    const app = (await viewOf(ctx, id)).application;
    expect(app.status).toBe('sent');
    expect(app.letter).toEqual(letter);
    expect(app.sentEmail).not.toBeNull();
    expect(app.history.map((h) => h.kind)).toEqual(['approved', 'sent']);
  });

  it('a package changed while it was printed is not sent: own reason, nothing recorded', async () => {
    const { ctx, id } = await setup();
    const print = ctx.printer.print.bind(ctx.printer);
    ctx.printer.print = async (html: string) => {
      ctx.applicationStore.update(id, (p) => { p.updatedAt = '2030-01-01T00:00:00.000Z'; });
      return print(html);
    };
    const r = await sendTo(ctx, id);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('packageChanged');
    expect(ctx.mailer.sent).toHaveLength(0);
    expect((await viewOf(ctx, id)).application).toMatchObject({ status: 'approved', sentAt: null, sentEmail: null });
  });

  it('attachment names are unique within the email', async () => {
    const { ctx, id } = await setup({ docs: ['Zeugnis', 'Zeugnis', 'Lebenslauf Max Mustermann'] });
    expect((await sendTo(ctx, id)).statusCode).toBe(200);
    const names = ctx.mailer.sent[0].mail.attachments.map((a) => a.filename);
    expect(names).toEqual(['Anschreiben_Max_Mustermann_Muster_GmbH.pdf', 'Lebenslauf_Max_Mustermann.pdf', 'Zeugnis.pdf', 'Zeugnis_2.pdf', 'Lebenslauf_Max_Mustermann_2.pdf']);
    expect((await viewOf(ctx, id)).application.sentEmail?.attachments).toEqual(names);
  });

  it('very long company and document names: every attachment name fits the stored limit, and the send is recorded', async () => {
    const long = 'Dokument '.repeat(28).trim();
    const { ctx, id } = await setup({ docs: [long, long] });
    ctx.applicationStore.update(id, (p) => { p.vacancy.company = `Muster ${'Holding '.repeat(36)}GmbH`.slice(0, 300); });
    const r = await sendTo(ctx, id);
    expect(r.statusCode).toBe(200);
    const names = ctx.mailer.sent[0].mail.attachments.map((a) => a.filename);
    expect(names).toHaveLength(4);
    for (const n of names) { expect(n.length).toBeLessThanOrEqual(200); expect(n).toMatch(/\.pdf$/); }
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(4);
    expect(names[3]).toMatch(/_2\.pdf$/);
    expect((await viewOf(ctx, id)).application).toMatchObject({ status: 'sent', sentEmail: { attachments: names } });
  });

  it('a full history is refused before anything is sent', async () => {
    const { ctx, id } = await setup();
    ctx.applicationStore.update(id, (p) => {
      p.history = Array.from({ length: 200 }, (_, i) => ({ kind: i % 2 === 0 ? 'draft' as const : 'approved' as const, at: '2026-09-01T10:00:00.000Z' }));
    });
    const r = await sendTo(ctx, id);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('historyFull');
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('a save that fails after the email went out: own reason, logged without data, never sent a second time', async () => {
    const lines: string[] = [];
    const logger: Logger = { info: (e, d) => lines.push(JSON.stringify({ e, d })), warn: (e, d) => lines.push(JSON.stringify({ e, d })), error: (e, d) => lines.push(JSON.stringify({ e, d })) };
    const { ctx, id } = await setup({ logger });
    const realUpdate = ctx.applicationStore.update.bind(ctx.applicationStore);
    ctx.applicationStore.update = () => { throw new AppError('DATA_WRITE_FAILED', 'disk full'); };
    const r = await sendTo(ctx, id);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('sentNotSaved');
    ctx.applicationStore.update = realUpdate;
    const again = await sendTo(ctx, id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.reason).toBe('sentNotSaved');
    expect(ctx.mailer.sent).toHaveLength(1);
    expect(ctx.sentUnsaved.has(id)).toBe(true);
    // "I applied myself" still records it.
    expect((await post(ctx, `/api/applications/${id}/submitted`, {})).statusCode).toBe(200);
    const log = lines.join('\n');
    expect(log).toContain('application_sent_unsaved');
    for (const secret of ['jobs@muster', 'Bewerbung als', 'geheim123']) expect(log).not.toContain(secret);
  });

  it('a package in the sent-but-not-saved log is refused before anything is sent', async () => {
    const { ctx, id } = await setup();
    ctx.sentUnsaved.add(id);
    const r = await sendTo(ctx, id);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('sentNotSaved');
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('downloads of a sent package keep the date the email went out', async () => {
    const { ctx, id } = await setup();
    expect((await sendTo(ctx, id)).statusCode).toBe(200);
    ctx.applicationStore.update(id, (p) => { p.sentAt = '2026-01-15T10:00:00.000Z'; p.history = p.history.map((h) => (h.kind === 'sent' ? { ...h, at: '2026-01-15T10:00:00.000Z' } : h)); });
    const html = (await ctx.app.inject({ method: 'GET', url: `/api/applications/${id}/preview/letter` })).body;
    expect(html).toContain('15.01.2026');
  });

  it('the log has no recipient, subject or body', async () => {
    const lines: string[] = [];
    const logger: Logger = { info: (e, d) => lines.push(JSON.stringify({ e, d })), warn: (e, d) => lines.push(JSON.stringify({ e, d })), error: (e, d) => lines.push(JSON.stringify({ e, d })) };
    const { ctx, id } = await setup({ logger });
    ctx.mailer.failWith = new AppError('MAIL_AUTH', 'fake');
    await sendTo(ctx, id);
    ctx.mailer.failWith = null;
    await sendTo(ctx, id);
    const log = lines.join('\n');
    expect(log).toContain('application_send_failed');
    expect(log).toContain('application_sent');
    for (const secret of ['jobs@muster', 'Bewerbung als', 'anbei meine', 'geheim123', 'Anschreiben_']) expect(log).not.toContain(secret);
  });
});

describe('copy as a new draft', () => {
  const copy = (ctx: Ctx, id: string) => post(ctx, `/api/applications/${id}/copy`, {});
  const newInfo = async (ctx: Ctx) => (await ctx.app.inject({ method: 'GET', url: '/api/applications/new?vacancyId=fav1' })).json() as { existingId: string | null };

  it('copies a sent package into a new draft (letter with hand edits, CV, attachments, language); the original keeps its history', async () => {
    const { ctx, id } = await setup({ docs: ['Zeugnis'] });
    await ctx.app.inject({ method: 'POST', url: `/api/applications/${id}/unapprove`, headers: H });
    await ctx.app.inject({ method: 'PATCH', url: `/api/applications/${id}/letter`, headers: H, payload: { closing: 'Beste Grüße' } });
    await post(ctx, `/api/applications/${id}/approve`, {});
    expect((await sendTo(ctx, id)).statusCode).toBe(200);
    const original = (await viewOf(ctx, id)).application;
    const r = await copy(ctx, id);
    expect(r.statusCode).toBe(200);
    const c = (r.json() as ApplicationView).application;
    expect(c.id).not.toBe(id);
    expect(c).toMatchObject({ vacancyId: 'fav1', status: 'draft', history: [], sentAt: null, sentEmail: null, approvedAt: null, language: original.language });
    expect(c.letter).toEqual(original.letter);
    expect(c.letter.closing).toBe('Beste Grüße');
    expect(c.cv).toEqual(original.cv);
    expect(c.attachments).toEqual(original.attachments);
    expect(c.attachments).toHaveLength(1);
    expect((await viewOf(ctx, id)).application).toEqual(original);
    // The copy can be edited, approved and sent; the vacancy links to it while it is not sent.
    expect((await ctx.app.inject({ method: 'PATCH', url: `/api/applications/${c.id}/letter`, headers: H, payload: { closing: 'Viele Grüße' } })).statusCode).toBe(200);
    expect(ctx.applicationStore.byVacancy('fav1')?.id).toBe(c.id);
    expect((await newInfo(ctx)).existingId).toBe(c.id);
    expect((await post(ctx, `/api/applications/${c.id}/approve`, {})).statusCode).toBe(200);
    expect((await sendTo(ctx, c.id)).statusCode).toBe(200);
    expect(ctx.mailer.sent).toHaveLength(2);
    expect(ctx.applicationStore.list().filter((s) => s.vacancyId === 'fav1')).toHaveLength(2);
  });

  it('refuses: a package not sent yet, and a second editable package for the same vacancy', async () => {
    const { ctx, id } = await setup();
    expect((await copy(ctx, id)).statusCode).toBe(409);
    expect((await sendTo(ctx, id)).statusCode).toBe(200);
    const first = (await copy(ctx, id)).json() as ApplicationView;
    const again = await copy(ctx, id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({ code: 'CONFLICT', reason: 'draftExists' });
    // Creating from the vacancy is refused too while the copy is not sent.
    const create = await post(ctx, '/api/applications', { vacancyId: 'fav1', language: 'de' });
    expect(create.statusCode).toBe(409);
    expect(create.json().error).toMatchObject({ code: 'PACKAGE_EXISTS', params: { id: first.application.id } });
  });

  it('creating from a vacancy is allowed when all its packages are sent; the vacancy then links to the newest', async () => {
    const { ctx, id } = await setup();
    expect((await sendTo(ctx, id)).statusCode).toBe(200);
    expect((await newInfo(ctx)).existingId).toBeNull();
    expect(ctx.applicationStore.byVacancy('fav1')?.id).toBe(id);
    const r = await post(ctx, '/api/applications', { vacancyId: 'fav1', language: 'en' });
    expect(r.statusCode).toBe(202);
    await ctx.applicationJob.whenIdle();
    const created = ctx.applicationJob.state().applicationId!;
    expect(created).not.toBe(id);
    expect(ctx.applicationStore.byVacancy('fav1')?.id).toBe(created);
    expect((await viewOf(ctx, id)).application.status).toBe('sent');
  });

  it('is refused while the package is being sent', async () => {
    const { ctx, id } = await setup();
    ctx.mailer.delayMs = 60;
    const inFlight = sendTo(ctx, id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const r = await copy(ctx, id);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('packageSending');
    expect((await inFlight).statusCode).toBe(200);
  });

  it('undoing "submitted" is refused while a copy of it is still unsent (one editable package per vacancy); allowed once the copy is gone', async () => {
    const { ctx, id } = await setup();
    expect((await post(ctx, `/api/applications/${id}/submitted`, {})).statusCode).toBe(200);
    const c = ((await copy(ctx, id)).json() as ApplicationView).application;
    const before = (await viewOf(ctx, id)).application;
    const r = await post(ctx, `/api/applications/${id}/status/undo`, {});
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'CONFLICT', reason: 'draftExists', params: { id: c.id } });
    expect((await viewOf(ctx, id)).application).toEqual(before);
    // An undo that keeps the package frozen is not affected.
    expect((await post(ctx, `/api/applications/${id}/status`, { status: 'interview', date: '2026-10-01' })).statusCode).toBe(200);
    expect((await post(ctx, `/api/applications/${id}/status/undo`, {})).statusCode).toBe(200);
    // Without the copy the package can go back to approved.
    await ctx.app.inject({ method: 'DELETE', url: `/api/applications/${c.id}`, headers: H });
    const ok = await post(ctx, `/api/applications/${id}/status/undo`, {});
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as ApplicationView).application.status).toBe('approved');
  });
});

describe('send-draft', () => {
  it('prefills To from the vacancy contact and lists attachments with sizes', async () => {
    const { ctx, id } = await setup({ contact: true });
    const r = await ctx.app.inject({ method: 'GET', url: `/api/applications/${id}/send-draft` });
    expect(r.statusCode).toBe(200);
    const d = r.json() as { to: string; subject: string; body: string; attachments: { name: string; size: number }[]; totalSize: number; mailReady: boolean };
    expect(d.to).toBe('jobs@muster.example');
    expect(d.subject).toBe((await viewOf(ctx, id)).application.letter.subject);
    expect(d.body).toContain('anbei sende ich Ihnen meine Bewerbung als');
    expect(d.attachments.map((a) => a.name)).toEqual(['Anschreiben_Max_Mustermann_Muster_GmbH.pdf', 'Lebenslauf_Max_Mustermann.pdf']);
    expect(d.attachments.every((a) => a.size > 0)).toBe(true);
    expect(d.totalSize).toBe(d.attachments.reduce((s, a) => s + a.size, 0));
    expect(d.mailReady).toBe(true);
    expect(ctx.mailer.sent).toHaveLength(0);
  });
  it('empty To without a contact; mailReady false when not connected', async () => {
    const { ctx, id } = await setup({ connected: false });
    const d = (await ctx.app.inject({ method: 'GET', url: `/api/applications/${id}/send-draft` })).json();
    expect(d).toMatchObject({ to: '', mailReady: false });
  });
});
