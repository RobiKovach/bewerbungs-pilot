import crypto from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { MailSettings } from '@bp/shared';
import { AppError } from '../errors.js';
import { googleErrorFrom, type GoogleAuth } from './google-auth.js';
import type { Mailer, OutgoingMail, SentMail } from './mailer.js';

export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';
/** With a conversation id: JSON metadata ({ threadId }) and the raw message in one multipart/related upload. */
export const GMAIL_SEND_MULTIPART_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart';
/** Gmail conversation ids are hex; anything else is never sent to Google. */
const THREAD_ID = /^[0-9a-f]{1,64}$/;

/** The request body: the raw message alone, or (to join a conversation) multipart/related with the thread id. */
export function sendRequest(raw: Buffer, threadId?: string): { url: string; contentType: string; body: Buffer } {
  if (!threadId || !THREAD_ID.test(threadId)) return { url: GMAIL_SEND_URL, contentType: 'message/rfc822', body: raw };
  const boundary = `bp_${crypto.randomBytes(12).toString('hex')}`;
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ threadId })}\r\n`
    + `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`;
  return {
    url: GMAIL_SEND_MULTIPART_URL,
    contentType: `multipart/related; boundary=${boundary}`,
    body: Buffer.concat([Buffer.from(head), raw, Buffer.from(`\r\n--${boundary}--`)]),
  };
}

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

/**
 * 401 → MAIL_REAUTH; 403 insufficientPermissions (the "send email" box was left unticked) → MAIL_SCOPE;
 * other 400/403/413 → MAIL_REJECTED; 429/5xx/anything else → MAIL_CONNECT.
 */
export function gmailErrorFrom(status: number, reason: string): AppError {
  const detail = `gmail ${status} ${reason}`.trim();
  if (status === 401) return new AppError('MAIL_REAUTH', detail);
  if (status === 403 && reason === 'insufficientPermissions') return new AppError('MAIL_SCOPE', detail);
  if (status === 400 || status === 403 || status === 413) return new AppError('MAIL_REJECTED', detail);
  return new AppError('MAIL_CONNECT', detail);
}

export class GmailApiMailer implements Mailer {
  constructor(private readonly auth: GoogleAuth, private readonly fetchImpl: typeof fetch = fetch) {}

  async send(config: MailSettings, refreshToken: string, mail: OutgoingMail): Promise<SentMail> {
    if (config.kind !== 'google') throw new AppError('MAIL_NOT_CONFIGURED', 'not a Google mailbox');
    let token: string;
    try {
      token = await this.auth.accessToken(refreshToken);
    } catch (err) {
      throw googleErrorFrom(err);
    }
    const request = sendRequest(await rawMessage(mail), mail.threadId);
    let res: Response;
    try {
      res = await this.fetchImpl(request.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': request.contentType },
        body: new Uint8Array(request.body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new AppError('MAIL_CONNECT', 'gmail unreachable');
    }
    let data = null as { id?: unknown; threadId?: unknown; error?: { status?: unknown; errors?: { reason?: unknown }[] } } | null;
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
    // Gmail accepted the message (2xx): never report a failure here, a retry would send it twice.
    const threadId = typeof data?.threadId === 'string' && THREAD_ID.test(data.threadId) ? data.threadId : undefined;
    return { messageId: typeof data?.id === 'string' && data.id !== '' ? data.id : 'gmail:unknown', ...(threadId ? { threadId } : {}) };
  }
}
