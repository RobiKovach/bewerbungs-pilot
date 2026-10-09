import nodemailer from 'nodemailer';
import type { MailSettings, SmtpMailSettings } from '@bp/shared';
import { AppError } from '../errors.js';

export interface OutgoingMail {
  from: { name: string; address: string };
  to: string;
  bcc?: string;
  subject: string;
  text: string;
  attachments: { filename: string; content: Buffer }[];
  inReplyTo?: string;
}

export interface Mailer {
  send(config: MailSettings, password: string, mail: OutgoingMail): Promise<{ messageId: string }>;
}

const CONNECT_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND', 'ETLS']);

/** Encrypted SMTP only: 465 = implicit TLS, 587 = STARTTLS that must succeed (never plain). */
export function transportOptions(config: SmtpMailSettings, password: string) {
  return {
    host: config.host,
    port: config.port,
    secure: config.security === 'ssl',
    requireTLS: config.security === 'starttls',
    auth: { user: config.user, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: { minVersion: 'TLSv1.2' as const },
  };
}

/** Maps a nodemailer/net error to a MAIL_* AppError. The log detail never contains the given secrets. */
export function mailErrorFrom(err: unknown, opts: { secrets?: string[] } = {}): AppError {
  const e = (typeof err === 'object' && err !== null ? err : {}) as { code?: unknown; responseCode?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : 0;
  let message = typeof e.message === 'string' ? e.message : typeof err === 'string' ? err : '';
  // Mask on the full text first, then cut, so a secret can never survive by being split at the cut.
  for (const secret of opts.secrets ?? []) {
    if (secret) message = message.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '***');
  }
  const detail = `${code} ${responseCode || ''} ${message.slice(0, 200)}`.replace(/\s+/g, ' ').trim();
  let mapped: 'MAIL_AUTH' | 'MAIL_CONNECT' | 'MAIL_REJECTED';
  if (code === 'EAUTH' || responseCode === 530 || responseCode === 534 || responseCode === 535) mapped = 'MAIL_AUTH';
  else if (CONNECT_CODES.has(code)) mapped = 'MAIL_CONNECT';
  else if (responseCode >= 500 || code === 'EENVELOPE' || code === 'EMESSAGE') mapped = 'MAIL_REJECTED';
  else mapped = 'MAIL_CONNECT';
  return new AppError(mapped, detail);
}

export class SmtpMailer implements Mailer {
  async send(config: MailSettings, password: string, mail: OutgoingMail): Promise<{ messageId: string }> {
    if (config.kind !== 'smtp') throw new AppError('MAIL_NOT_CONFIGURED', 'not an SMTP mailbox');
    const transport = nodemailer.createTransport(transportOptions(config, password));
    try {
      const info = await transport.sendMail({
        from: { name: mail.from.name, address: mail.from.address },
        to: mail.to,
        bcc: mail.bcc,
        subject: mail.subject,
        text: mail.text,
        attachments: mail.attachments,
        ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
      });
      return { messageId: String(info.messageId) };
    } catch (err) {
      throw mailErrorFrom(err, { secrets: [password, config.user, mail.to, mail.bcc ?? '', mail.from.address] });
    } finally {
      transport.close();
    }
  }
}
