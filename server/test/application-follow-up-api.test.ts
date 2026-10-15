import { describe, it, expect } from 'vitest';
import type { MailDraft } from '@bp/shared';
import { AppError } from '../src/errors.js';
import path_ from 'node:path';
import { SentUnsavedLog } from '../src/applications/sent-unsaved.js';
import { H } from './helpers/app.js';
import { type Ctx, post, sendTo, setup, viewOf } from './helpers/sending.js';

const BODY = { to: 'jobs@muster.example', subject: 'Re: Bewerbung als Webentwickler (m/w/d)', body: 'Guten Tag,\n\nwie ist der Stand?\n\nMax Mustermann' };
const get = (ctx: Ctx, id: string, path: string) => ctx.app.inject({ method: 'GET', url: `/api/applications/${id}/${path}`, headers: H });
const age = (ctx: Ctx, id: string) => ctx.applicationStore.update(id, (p) => { const e = p.history.find((h) => h.kind === 'sent' || h.kind === 'submitted')!; e.at = '2026-01-01T10:00:00.000Z'; });
const status = (ctx: Ctx, id: string, s: string) => post(ctx, `/api/applications/${id}/status`, { status: s, date: '2026-10-08' });

async function sentPackage() {
  const r = await setup();
  expect((await sendTo(r.ctx, r.id)).statusCode).toBe(200);
  age(r.ctx, r.id);
  return r;
}

describe('reminder', () => {
  it('draft: the address the application went to, Re: subject, mail ready', async () => {
    const { ctx, id } = await sentPackage();
    const r = await get(ctx, id, 'follow-up-draft');
    expect(r.statusCode).toBe(200);
    const d = r.json() as MailDraft;
    expect(d).toMatchObject({ to: 'jobs@muster.example', subject: 'Re: Bewerbung als Webentwickler (m/w/d)', mailReady: true });
    expect(d.body).toContain('Stand meiner Bewerbung');
    expect((await viewOf(ctx, id)).followUpDue).toBe(true);
  });

  it('send: no attachments, BCC to self, In-Reply-To the original; history gets followUp; status stays sent', async () => {
    const { ctx, id } = await sentPackage();
    const r = await post(ctx, `/api/applications/${id}/follow-up/send`, BODY);
    expect(r.statusCode).toBe(200);
    expect(ctx.mailer.sent).toHaveLength(2);
    expect(ctx.mailer.sent[1].mail).toMatchObject({ to: 'jobs@muster.example', bcc: 'max@example.com', subject: BODY.subject, text: BODY.body, attachments: [], inReplyTo: '<fake-1@example.com>' });
    const v = await viewOf(ctx, id);
    expect(v.application.status).toBe('sent');
    expect(v.application.history.at(-1)).toMatchObject({ kind: 'followUp', to: 'jobs@muster.example', messageId: '<fake-2@example.com>' });
    expect(v.followUpDue).toBe(false);
  });

  it('Google mailbox: the sent entry keeps the Gmail conversation id and the reminder joins it', async () => {
    const { ctx, id } = await setup();
    ctx.settings.setMail({ kind: 'google', address: 'max@gmail.com', senderName: 'Max Mustermann', provider: 'gmail' });
    ctx.mailer.threadId = '1a13e5cfb151d3ae';
    expect((await sendTo(ctx, id)).statusCode).toBe(200);
    age(ctx, id);
    expect((await viewOf(ctx, id)).application.history.find((h) => h.kind === 'sent')).toMatchObject({ threadId: '1a13e5cfb151d3ae' });
    ctx.mailer.threadId = undefined;
    expect((await post(ctx, `/api/applications/${id}/follow-up/send`, BODY)).statusCode).toBe(200);
    expect(ctx.mailer.sent[1].mail.threadId).toBe('1a13e5cfb151d3ae');
  });

  it('SMTP mailbox: no conversation id is ever passed on (SMTP threads by In-Reply-To)', async () => {
    const { ctx, id } = await sentPackage();
    ctx.applicationStore.update(id, (p) => { p.history.find((h) => h.kind === 'sent')!.threadId = 'abc123'; });
    expect((await post(ctx, `/api/applications/${id}/follow-up/send`, BODY)).statusCode).toBe(200);
    expect(ctx.mailer.sent[1].mail.threadId).toBeUndefined();
    expect(ctx.mailer.sent[1].mail.inReplyTo).toBe('<fake-1@example.com>');
  });

  it('a second send, mark or dismiss afterwards is refused with followUpDone', async () => {
    const { ctx, id } = await sentPackage();
    await post(ctx, `/api/applications/${id}/follow-up/send`, BODY);
    for (const path of ['send', 'mark', 'dismiss']) {
      const r = await post(ctx, `/api/applications/${id}/follow-up/${path}`, path === 'send' ? BODY : {});
      expect(r.statusCode).toBe(409);
      expect(r.json().error.reason).toBe('followUpDone');
    }
    expect((await get(ctx, id, 'follow-up-draft')).statusCode).toBe(409);
    expect(ctx.mailer.sent).toHaveLength(2);
  });

  it('dismiss and mark record an event; mark has no address', async () => {
    const a = await sentPackage();
    expect((await post(a.ctx, `/api/applications/${a.id}/follow-up/dismiss`, {})).statusCode).toBe(200);
    const va = await viewOf(a.ctx, a.id);
    expect(va.application.history.at(-1)).toMatchObject({ kind: 'followUpDismissed' });
    expect(va.followUpDue).toBe(false);
    const b = await sentPackage();
    expect((await post(b.ctx, `/api/applications/${b.id}/follow-up/mark`, {})).statusCode).toBe(200);
    const last = (await viewOf(b.ctx, b.id)).application.history.at(-1)!;
    expect(last.kind).toBe('followUp');
    expect(last.to).toBeUndefined();
    expect(b.ctx.mailer.sent).toHaveLength(1);
  });

  it('a submitted package has no address: empty draft, a typed address works', async () => {
    const { ctx, id } = await setup();
    expect((await post(ctx, `/api/applications/${id}/submitted`, {})).statusCode).toBe(200);
    age(ctx, id);
    expect(((await get(ctx, id, 'follow-up-draft')).json() as MailDraft).to).toBe('');
    expect((await post(ctx, `/api/applications/${id}/follow-up/send`, BODY)).statusCode).toBe(200);
    expect(ctx.mailer.sent).toHaveLength(1);
    expect(ctx.mailer.sent[0].mail.inReplyTo).toBeUndefined();
  });

  it('two parallel sends send one email', async () => {
    const { ctx, id } = await sentPackage();
    ctx.mailer.delayMs = 50;
    const [a, b] = await Promise.all([post(ctx, `/api/applications/${id}/follow-up/send`, BODY), post(ctx, `/api/applications/${id}/follow-up/send`, BODY)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const failed = a.statusCode === 409 ? a : b;
    expect(failed.json().error.reason).toBe('packageSending');
    expect(ctx.mailer.sent).toHaveLength(2);
  });

  it('after "sent but not saved" the reminder is refused and nothing is sent', async () => {
    const { ctx, id } = await sentPackage();
    ctx.sentUnsaved.add(`${id}:followUp`);
    const r = await post(ctx, `/api/applications/${id}/follow-up/send`, BODY);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.reason).toBe('sentNotSaved');
    expect(ctx.mailer.sent).toHaveLength(1);
  });

  it('a mailer failure changes nothing', async () => {
    const { ctx, id } = await sentPackage();
    const before = (await viewOf(ctx, id)).application.history;
    ctx.mailer.failWith = new AppError('MAIL_AUTH', 'fake');
    const r = await post(ctx, `/api/applications/${id}/follow-up/send`, BODY);
    expect(r.statusCode).toBe(502);
    expect((await viewOf(ctx, id)).application.history).toEqual(before);
  });

  it('a header-injecting address is rejected', async () => {
    const { ctx, id } = await sentPackage();
    const r = await post(ctx, `/api/applications/${id}/follow-up/send`, { ...BODY, to: 'a@b.de\r\nBcc: x@y.de' });
    expect(r.statusCode).toBe(400);
    expect(ctx.mailer.sent).toHaveLength(1);
  });
});

describe('rejection / offer reply', () => {
  it('reply-draft: refused for sent; template for rejected; reply/send records reply and keeps the status', async () => {
    const { ctx, id } = await sentPackage();
    expect((await get(ctx, id, 'reply-draft')).statusCode).toBe(409);
    expect((await post(ctx, `/api/applications/${id}/reply/send`, BODY)).statusCode).toBe(409);
    expect((await status(ctx, id, 'rejected')).statusCode).toBe(200);
    const d = (await get(ctx, id, 'reply-draft')).json() as MailDraft;
    expect(d).toMatchObject({ to: 'jobs@muster.example', subject: 'Re: Bewerbung als Webentwickler (m/w/d)', mailReady: true });
    expect(d.body).toContain('Muster GmbH');
    expect((await post(ctx, `/api/applications/${id}/reply/send`, { ...BODY, body: d.body })).statusCode).toBe(200);
    expect(ctx.mailer.sent).toHaveLength(2);
    expect(ctx.mailer.sent[1].mail.attachments).toEqual([]);
    const v = await viewOf(ctx, id);
    expect(v.application.status).toBe('rejected');
    expect(v.application.history.at(-1)).toMatchObject({ kind: 'reply', to: 'jobs@muster.example', messageId: '<fake-2@example.com>' });
  });

  it('an interview package has no reply', async () => {
    const { ctx, id } = await sentPackage();
    expect((await status(ctx, id, 'interview')).statusCode).toBe(200);
    expect((await get(ctx, id, 'reply-draft')).statusCode).toBe(409);
    expect((await post(ctx, `/api/applications/${id}/reply/send`, BODY)).statusCode).toBe(409);
    expect(ctx.mailer.sent).toHaveLength(1);
  });

  it('offer: the draft carries the stored offer reply (empty if none)', async () => {
    const { ctx, id } = await sentPackage();
    expect((await status(ctx, id, 'offer')).statusCode).toBe(200);
    const d = (await get(ctx, id, 'reply-draft')).json() as MailDraft;
    expect(d.body).toBe('');
    expect(d.subject).toBe('Re: Bewerbung als Webentwickler (m/w/d)');
  });
});

describe('reminder / reply sent but not saved', () => {
  const failSave = (ctx: Ctx) => {
    const real = ctx.applicationStore.update.bind(ctx.applicationStore);
    ctx.applicationStore.update = () => { throw new AppError('DATA_WRITE_FAILED', 'disk full'); };
    return () => { ctx.applicationStore.update = real; };
  };

  it.each([
    ['followUp', 'follow-up/send', async () => (await sentPackage())],
    ['reply', 'reply/send', async () => { const r = await sentPackage(); expect((await status(r.ctx, r.id, 'rejected')).statusCode).toBe(200); return r; }],
  ] as const)('%s: a save failure after sending blocks it for good (also after a restart); one email in total', async (kind, path, make) => {
    const { ctx, id } = await make();
    const before = ctx.mailer.sent.length;
    const restore = failSave(ctx);
    const first = await post(ctx, `/api/applications/${id}/${path}`, BODY);
    expect(first.statusCode).toBe(409);
    expect(first.json().error.reason).toBe('sentNotSaved');
    expect(ctx.mailer.sent).toHaveLength(before + 1);
    restore();
    const second = await post(ctx, `/api/applications/${id}/${path}`, BODY);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.reason).toBe('sentNotSaved');
    expect(ctx.mailer.sent).toHaveLength(before + 1);
    const restarted = new SentUnsavedLog(path_.join(ctx.dir, 'applications', 'sent-unsaved.json'));
    restarted.load();
    expect(restarted.has(`${id}:${kind}`)).toBe(true);
    expect(restarted.has(id)).toBe(false);
  });
});
