import type { Mailer, MailMessage } from './store.js';

export const RESEND_URL = 'https://api.resend.com/emails';
/** Resend's shared sender: without an own domain it delivers only to the account owner, which is exactly Robert. */
export const FROM = 'BewerbungsPilot <onboarding@resend.dev>';
const TIMEOUT_MS = 10_000;

/** Mails to Robert (the ROBERT_EMAIL secret) through Resend's HTTP API. Never throws: false when it did not go out. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly to: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  async send(m: MailMessage): Promise<boolean> {
    if (!this.apiKey || !this.to) return false;
    try {
      const res = await this.fetchFn(RESEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        // The person's address goes only into reply_to, its own JSON field: nothing they typed becomes a header line.
        body: JSON.stringify({ from: FROM, to: [this.to], subject: m.subject, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => undefined);
      return res.ok;
    } catch {
      return false;
    }
  }
}
