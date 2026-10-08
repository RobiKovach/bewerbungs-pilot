import { describe, expect, it, vi } from 'vitest';

const sendMail = vi.hoisted(() => vi.fn());
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail, close: () => undefined }) } }));

import { mailErrorFrom, SmtpMailer, transportOptions } from '../src/mail/mailer.js';
import { httpStatusFor } from '../src/errors.js';
import type { MailSettings } from '@bp/shared';

const base: MailSettings = { address: 'max@example.com', senderName: 'Max Mustermann', host: 'smtp.example.com', port: 465, security: 'ssl', user: 'max@example.com', provider: 'other' };

describe('mailErrorFrom', () => {
  it('maps wrong credentials to MAIL_AUTH', () => {
    const e = mailErrorFrom({ code: 'EAUTH', responseCode: 535, message: '535 5.7.8 Username and Password not accepted' });
    expect(e.code).toBe('MAIL_AUTH');
    expect(e.detailsForLog).toContain('EAUTH');
  });
  it('maps 534/535 without a code to MAIL_AUTH', () => {
    expect(mailErrorFrom({ responseCode: 534, message: 'x' }).code).toBe('MAIL_AUTH');
  });
  it.each(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND', 'ETLS'])('maps %s to MAIL_CONNECT', (code) => {
    expect(mailErrorFrom({ code }).code).toBe('MAIL_CONNECT');
  });
  it('maps a refused message to MAIL_REJECTED', () => {
    expect(mailErrorFrom({ code: 'EMESSAGE', responseCode: 552, message: '552 Message size exceeds' }).code).toBe('MAIL_REJECTED');
    expect(mailErrorFrom({ code: 'EENVELOPE' }).code).toBe('MAIL_REJECTED');
    expect(mailErrorFrom({ responseCode: 550, message: 'no such user' }).code).toBe('MAIL_REJECTED');
  });
  it('maps anything else to MAIL_CONNECT', () => {
    expect(mailErrorFrom(new Error('weird')).code).toBe('MAIL_CONNECT');
    expect(mailErrorFrom('boom').code).toBe('MAIL_CONNECT');
  });
  it('removes the password and the user name from detailsForLog', () => {
    const e = mailErrorFrom(new Error('auth failed for max@example.com with geheim123'), { secrets: ['geheim123', 'max@example.com'] });
    expect(e.detailsForLog).not.toContain('geheim123');
    expect(e.detailsForLog).not.toContain('max@example.com');
  });
  it('ignores empty secrets and keeps at most 200 characters of the message', () => {
    const e = mailErrorFrom(new Error('a'.repeat(500)), { secrets: ['', ''] });
    expect(e.detailsForLog).toContain('a'.repeat(200));
    expect(e.detailsForLog).not.toContain('a'.repeat(201));
  });
  it('maps 530 (authentication required) to MAIL_AUTH', () => {
    expect(mailErrorFrom({ responseCode: 530, message: '530 Authentication required' }).code).toBe('MAIL_AUTH');
  });
  it('masks secrets case-insensitively', () => {
    const e = mailErrorFrom({ code: 'EENVELOPE', responseCode: 550, message: '550 <JOBS@MUSTER.EXAMPLE> no such user' }, { secrets: ['jobs@muster.example'] });
    expect(e.code).toBe('MAIL_REJECTED');
    expect(e.detailsForLog.toLowerCase()).not.toContain('jobs@muster.example');
  });
  it('has HTTP statuses', () => {
    expect(httpStatusFor('MAIL_NOT_CONFIGURED')).toBe(409);
    expect(httpStatusFor('MAIL_AUTH')).toBe(502);
    expect(httpStatusFor('MAIL_CONNECT')).toBe(503);
    expect(httpStatusFor('MAIL_REJECTED')).toBe(502);
  });
});

describe('transportOptions', () => {
  it('uses implicit TLS on 465', () => {
    const o = transportOptions(base, 'pw');
    expect(o).toMatchObject({ host: 'smtp.example.com', port: 465, secure: true, requireTLS: false, auth: { user: 'max@example.com', pass: 'pw' }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000, tls: { minVersion: 'TLSv1.2' } });
  });
  it('requires STARTTLS on 587', () => {
    const o = transportOptions({ ...base, port: 587, security: 'starttls' }, 'pw');
    expect(o).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });
});

describe('SmtpMailer.send', () => {
  it('masks recipient, BCC and sender address in the error log detail', async () => {
    sendMail.mockRejectedValueOnce(Object.assign(new Error('550 jobs@muster.example / max@example.com rejected'), { code: 'EENVELOPE', responseCode: 550 }));
    const mail = { from: { name: 'Max Mustermann', address: 'max@example.com' }, to: 'jobs@muster.example', bcc: 'me@example.com', subject: 's', text: 't', attachments: [] };
    const err = await new SmtpMailer().send(base, 'geheim123', mail).catch((e: unknown) => e) as { code: string; detailsForLog: string };
    expect(err.code).toBe('MAIL_REJECTED');
    expect(err.detailsForLog).not.toContain('jobs@muster.example');
    expect(err.detailsForLog).not.toContain('max@example.com');
  });
});
