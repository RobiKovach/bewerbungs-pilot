import { describe, expect, it } from 'vitest';
import type { AppError } from '../src/errors.js';
import { GMAIL_SEND_URL, GmailApiMailer, rawMessage } from '../src/mail/gmail-api.js';
import { LibraryGoogleAuth, googleErrorFrom } from '../src/mail/google-auth.js';
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
    const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: '18c0ffee', threadId: 't1' }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await new GmailApiMailer(auth, fetchImpl).send(GOOGLE, '1//refresh-secret', MAIL);
    expect(r).toEqual({ messageId: '18c0ffee' });
    expect(calls[0].url).toBe(GMAIL_SEND_URL);
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.secret-access');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('message/rfc822');
  });

  it.each([
    [401, 'authError', 'MAIL_REAUTH'], [403, 'insufficientPermissions', 'MAIL_REAUTH'], [400, 'invalidArgument', 'MAIL_REJECTED'],
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
