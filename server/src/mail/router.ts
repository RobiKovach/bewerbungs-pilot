import type { MailSettings } from '@bp/shared';
import type { Mailer, OutgoingMail } from './mailer.js';

/** Picks the SMTP or the Gmail API mailer by the saved mailbox kind; `secret` = app password or refresh token. */
export class MailRouter implements Mailer {
  constructor(private readonly smtp: Mailer, private readonly google: Mailer) {}

  send(config: MailSettings, secret: string, mail: OutgoingMail): Promise<{ messageId: string }> {
    return (config.kind === 'google' ? this.google : this.smtp).send(config, secret, mail);
  }
}
