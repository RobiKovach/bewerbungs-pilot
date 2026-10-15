import { describe, expect, it } from 'vitest';
import type { AppError } from '../src/errors.js';
import { GMAIL_SEND_MULTIPART_URL, GMAIL_SEND_URL, GmailApiMailer, rawMessage, sendRequest } from '../src/mail/gmail-api.js';
import { LibraryGoogleAuth, googleErrorFrom, grantsSending } from '../src/mail/google-auth.js';
import type { OutgoingMail } from '../src/mail/mailer.js';
import { FakeGoogleAuth } from './helpers/mail.js';

const MAIL: OutgoingMail = {
  from: { name: 'Max Mustermann', address: 'max@gmail.com' }, to: 'jobs@muster.example', bcc: 'max@gmail.com',
  subject: 'Bewerbung als Webentwickler (m/w/d)', text: 'Sehr geehrte Damen und Herren,\n\nanbei …',
  attachments: [{ filename: 'Anschreiben_Max_Mustermann_Muster_GmbH.pdf', content: Buffer.from('%PDF-1.7 test') }],
};
const GOOGLE = { kind: 'google', address: 'max@gmail.com', senderName: 'Max Mustermann', provider: 'gmail' } as const;

describe('Gmail API mailer', () => {
  it('the raw message keeps Bcc, To, subject and the attachment with its name', async () => {
    const raw = (await rawMessage(MAIL)).toString('utf8');
    expect(raw).toMatch(/^Bcc: max@gmail\.com$/m);
    expect(raw).toMatch(/^To: jobs@muster\.example$/m);
    expect(raw).toMatch(/^From: Max Mustermann <max@gmail\.com>$/m);
    expect(raw).toContain('filename=Anschreiben_Max_Mustermann_Muster_GmbH.pdf');
    expect(raw).toContain(Buffer.from('%PDF-1.7 test').toString('base64'));
  });

  it('posts the raw message to the Gmail upload endpoint with a fresh access token', async () => {
    const auth = new FakeGoogleAuth(); auth.accessTokenResult = 'ya29.secret-access';
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: '18c0ffee', threadId: '18c0ffee' }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await new GmailApiMailer(auth, fetchImpl).send(GOOGLE, '1//refresh-secret', MAIL);
    expect(r).toEqual({ messageId: '18c0ffee', threadId: '18c0ffee' });
    expect(calls[0].url).toBe(GMAIL_SEND_URL);
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.secret-access');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('message/rfc822');
  });

  it('with a conversation id: one multipart/related upload with { threadId } and the raw message', async () => {
    const auth = new FakeGoogleAuth(); auth.accessTokenResult = 'ya29.x';
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: '1a13e5d9', threadId: '1a13e5cf' }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await new GmailApiMailer(auth, fetchImpl).send(GOOGLE, 'r', { ...MAIL, attachments: [], threadId: '1a13e5cf' });
    expect(r).toEqual({ messageId: '1a13e5d9', threadId: '1a13e5cf' });
    expect(calls[0].url).toBe(GMAIL_SEND_MULTIPART_URL);
    const type = (calls[0].init.headers as Record<string, string>)['Content-Type'];
    const boundary = /^multipart\/related; boundary=(bp_[0-9a-f]+)$/.exec(type)?.[1];
    expect(boundary).toBeDefined();
    const body = Buffer.from(calls[0].init.body as Uint8Array).toString('utf8');
    expect(body).toContain(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"threadId":"1a13e5cf"}\r\n`);
    expect(body).toContain(`--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`);
    expect(body).toMatch(/^To: jobs@muster\.example\r?$/m);
    expect(body.endsWith(`\r\n--${boundary}--`)).toBe(true);
  });

  it.each([[undefined], [''], ['not-hex!'], ['"},{"x":1']])('no usable conversation id (%j) → the plain upload, nothing else goes to Google', (threadId) => {
    const raw = Buffer.from('raw');
    expect(sendRequest(raw, threadId)).toEqual({ url: GMAIL_SEND_URL, contentType: 'message/rfc822', body: raw });
  });

  it.each([
    ['openid https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email', true],
    ['openid https://www.googleapis.com/auth/userinfo.email', false],
    ['https://www.googleapis.com/auth/gmail.sendx', false],
    [undefined, true], ['', true],
  ])('grantsSending(%j) → %s (no list at all is not a refusal)', (scope, ok) => {
    expect(grantsSending(scope)).toBe(ok);
  });

  it.each([
    [401, 'authError', 'MAIL_REAUTH'], [403, 'insufficientPermissions', 'MAIL_SCOPE'], [400, 'invalidArgument', 'MAIL_REJECTED'],
    [413, 'tooLarge', 'MAIL_REJECTED'], [429, 'rateLimitExceeded', 'MAIL_CONNECT'], [503, 'backendError', 'MAIL_CONNECT'],
  ])('Gmail %i %s → %s, no secret in the detail', async (status, reason, code) => {
    const auth = new FakeGoogleAuth(); auth.accessTokenResult = 'ya29.secret-access';
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { code: status, status: 'X', message: 'Recipient jobs@muster.example …', errors: [{ reason }] } }), { status })) as unknown as typeof fetch;
    const err = await new GmailApiMailer(auth, fetchImpl).send(GOOGLE, '1//refresh-secret', MAIL).then(() => null, (e: unknown) => e as AppError) as AppError;
    expect(err.code).toBe(code);
    expect(err.detailsForLog).not.toMatch(/secret|ya29|jobs@muster/);
  });

  it('network failure → MAIL_CONNECT; refresh token revoked (invalid_grant) → MAIL_REAUTH', async () => {
    const auth = new FakeGoogleAuth(); auth.accessTokenResult = 'ya29.x';
    const offline = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect((await new GmailApiMailer(auth, offline).send(GOOGLE, 'r', MAIL).then(() => null, (e: unknown) => e as AppError))?.code).toBe('MAIL_CONNECT');
    expect(googleErrorFrom({ message: 'invalid_grant', response: { status: 400, data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } }).code).toBe('MAIL_REAUTH');
    expect(googleErrorFrom({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND oauth2.googleapis.com' }).code).toBe('MAIL_CONNECT');
  });

  it.each([['{"threadId":"t1"}'], ['<html>proxy</html>'], ['']])('a 2xx answer without a readable id (%j) still counts as sent, so "Try again" cannot double-send', async (body) => {
    const auth = new FakeGoogleAuth(); auth.accessTokenResult = 'ya29.x';
    const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    expect(await new GmailApiMailer(auth, fetchImpl).send(GOOGLE, 'r', MAIL)).toEqual({ messageId: 'gmail:unknown' });
  });

  it('Google token calls are bounded by a 30 s timeout', () => {
    const client = (new LibraryGoogleAuth({ id: 'id', secret: 's' }) as unknown as { oauth(): { transporter: { defaults?: { timeout?: number } } } }).oauth();
    expect(client.transporter.defaults?.timeout).toBe(30_000);
  });

  it('refuses an SMTP config', async () => {
    const smtp = { kind: 'smtp', address: 'max@example.com', senderName: 'Max', host: 'smtp.example.com', port: 465, security: 'ssl', user: 'max@example.com', provider: 'other' } as const;
    expect((await new GmailApiMailer(new FakeGoogleAuth()).send(smtp, 'x', MAIL).then(() => null, (e: unknown) => e as AppError))?.code).toBe('MAIL_NOT_CONFIGURED');
  });
});
