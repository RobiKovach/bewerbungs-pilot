import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { ApplicationView } from '@bp/shared';
import { AppError } from '../src/errors.js';
import type { Logger } from '../src/log.js';
import { H, makeApp } from './helpers/app.js';
import { makePdf, packageClaude, readyPackageProfile } from './helpers/applications.js';
import { vacancy } from './helpers/vacancies.js';

const OFFER = 'Wir suchen einen Webentwickler (m/w/d) für unser Team in Hamburg. '.repeat(12);
const MAIL = { address: 'max@example.com', senderName: 'Max Mustermann', host: 'smtp.example.com', port: 465, security: 'ssl' as const, user: 'max@example.com', provider: 'other' };
const MAIL_BODY = { to: 'jobs@muster.example', subject: 'Bewerbung als Webentwickler (m/w/d)', body: 'Sehr geehrte Damen und Herren,\n\nanbei meine Bewerbung.\n\nMax Mustermann' };

type Ctx = Awaited<ReturnType<typeof makeApp>>;
const post = (ctx: Ctx, url: string, payload: unknown) => ctx.app.inject({ method: 'POST', url, headers: H, payload: payload as Record<string, unknown> });
const sendTo = (ctx: Ctx, id: string, payload: unknown = MAIL_BODY) => post(ctx, `/api/applications/${id}/send`, payload);
const viewOf = async (ctx: Ctx, id: string) => (await ctx.app.inject({ method: 'GET', url: `/api/applications/${id}` })).json() as ApplicationView;

async function setup(opts: { connected?: boolean; approve?: boolean; logger?: Logger; contact?: boolean; docs?: string[] } = {}) {
  const ctx = await makeApp({ provider: packageClaude(), logger: opts.logger });
  const docIds = (opts.docs ?? []).map((_, i) => `${i + 1}1111111-2222-4333-8444-555555555555`);
  ctx.profileStore.update((p) => {
    Object.assign(p, readyPackageProfile());
    p.documents = (opts.docs ?? []).map((label, i) => ({ id: docIds[i], ext: '.pdf' as const, originalName: `${label}.pdf`, size: 100, uploadedAt: '2026-09-01T10:00:00.000Z', label, attachAlways: true }));
  });
  for (const docId of docIds) fs.writeFileSync(ctx.profileFiles.pathOf({ id: docId, ext: '.pdf' }), await makePdf(1));
  ctx.vacancyStore.add(vacancy({
    id: 'fav1', status: 'favorite', company: 'Muster GmbH', locations: ['Hamburg'],
    ...(opts.contact ? { contact: { email: 'jobs@muster.example', salutation: 'Frau', name: 'Weiler' } } : {}),
  }), OFFER);
  await ctx.app.inject({ method: 'POST', url: '/api/applications', headers: H, payload: { vacancyId: 'fav1', language: 'de' } });
  await ctx.applicationJob.whenIdle();
  const id = ctx.applicationJob.state().applicationId!;
  if (opts.connected !== false) { ctx.settings.setMail(MAIL); await ctx.secrets.save('geheim123'); }
  if (opts.approve !== false) await post(ctx, `/api/applications/${id}/approve`, {});
  return { ctx, id };
}

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
