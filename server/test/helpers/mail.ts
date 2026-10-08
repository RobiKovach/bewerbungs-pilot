import type { MailSettings } from '@bp/shared';
import type { AppError } from '../../src/errors.js';
import type { Mailer, OutgoingMail } from '../../src/mail/mailer.js';

/** Test double: records what would be sent, never keeps the password. */
export class FakeMailer implements Mailer {
  sent: { config: MailSettings; mail: OutgoingMail }[] = [];
  failWith: AppError | null = null;
  delayMs = 0;

  async send(config: MailSettings, _password: string, mail: OutgoingMail): Promise<{ messageId: string }> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failWith) throw this.failWith;
    this.sent.push({ config, mail });
    return { messageId: `<fake-${this.sent.length}@example.com>` };
  }
}
