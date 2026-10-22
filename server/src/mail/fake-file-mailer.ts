import fs from 'node:fs';
import path from 'node:path';
import type { MailSettings } from '@bp/shared';
import { writeJsonAtomic } from '../data/atomic.js';
import type { Mailer, OutgoingMail, SentMail } from './mailer.js';

/**
 * `--fake-mail` (end-to-end runs): every mail — SMTP or Google mailbox, test mail or application — is written as one
 * JSON file into `dir` (`<data>/tmp/fake-mail/`) instead of being sent. Never opens a connection. Attachments are kept
 * as name + size only; the password/key is never written.
 */
export class FakeFileMailer implements Mailer {
  private count: number | null = null;

  constructor(private readonly dir: string) {}

  async send(config: MailSettings, _password: string, mail: OutgoingMail): Promise<SentMail> {
    fs.mkdirSync(this.dir, { recursive: true });
    // Go on counting after a restart, so file names and message ids never repeat in the same data folder.
    this.count ??= fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).length;
    const n = ++this.count;
    writeJsonAtomic(path.join(this.dir, `${Date.now()}-${n}.json`), {
      kind: config.kind,
      from: mail.from,
      to: mail.to,
      cc: null,
      bcc: mail.bcc ?? null,
      subject: mail.subject,
      text: mail.text,
      inReplyTo: mail.inReplyTo ?? null,
      threadId: mail.threadId ?? null,
      attachments: mail.attachments.map((a) => ({ filename: a.filename, size: a.content.length })),
    });
    // Like the Gmail API, a Google mailbox answers with a conversation id (the given one for a reply).
    return { messageId: `fake-${n}`, ...(config.kind === 'google' ? { threadId: mail.threadId ?? `fake-thread-${n}` } : {}) };
  }
}
