import MailComposer from 'nodemailer/lib/mail-composer';
import type { MailSettings } from '@bp/shared';
import { AppError } from '../errors.js';
import { googleErrorFrom, type GoogleAuth } from './google-auth.js';
import type { Mailer, OutgoingMail } from './mailer.js';

export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';

export async function rawMessage(mail: OutgoingMail): Promise<Buffer> {
  const node = new MailComposer({
    from: { name: mail.from.name, address: mail.from.address },
    to: mail.to,
    bcc: mail.bcc,
    subject: mail.subject,
    text: mail.text,
    attachments: mail.attachments,
    ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
  }).compile();
  node.keepBcc = true; // Gmail reads Bcc from the raw message, delivers it and removes the header
  return node.build();
}

/** 401 / 403 insufficientPermissions → MAIL_REAUTH; other 400/403/413 → MAIL_REJECTED; 429/5xx/anything else → MAIL_CONNECT. */
export function gmailErrorFrom(status: number, reason: string): AppError {
  const detail = `gmail ${status} ${reason}`.trim();
  if (status === 401 || (status === 403 && reason === 'insufficientPermissions')) return new AppError('MAIL_REAUTH', detail);
  if (status === 400 || status === 403 || status === 413) return new AppError('MAIL_REJECTED', detail);
  return new AppError('MAIL_CONNECT', detail);
}

export class GmailApiMailer implements Mailer {
  constructor(private readonly auth: GoogleAuth, private readonly fetchImpl: typeof fetch = fetch) {}

  async send(config: MailSettings, refreshToken: string, mail: OutgoingMail): Promise<{ messageId: string }> {
    if (config.kind !== 'google') throw new AppError('MAIL_NOT_CONFIGURED', 'not a Google mailbox');
    let token: string;
    try {
      token = await this.auth.accessToken(refreshToken);
    } catch (err) {
      throw googleErrorFrom(err);
    }
    const body = await rawMessage(mail);
    let res: Response;
    try {
      res = await this.fetchImpl(GMAIL_SEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'message/rfc822' },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new AppError('MAIL_CONNECT', 'gmail unreachable');
    }
    let data = null as { id?: unknown; error?: { status?: unknown; errors?: { reason?: unknown }[] } } | null;
    try {
      data = (await res.json()) as NonNullable<typeof data>;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const raw = data?.error?.errors?.[0]?.reason ?? data?.error?.status;
      const reason = typeof raw === 'string' ? raw.replace(/[^A-Za-z_]/g, '').slice(0, 40) : '';
      throw gmailErrorFrom(res.status, reason);
    }
    if (typeof data?.id !== 'string') throw new AppError('MAIL_CONNECT', 'gmail returned no message id');
    return { messageId: data.id };
  }
}
