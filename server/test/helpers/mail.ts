import type { MailSettings } from '@bp/shared';
import { AppError } from '../../src/errors.js';
import type { GoogleAuth, GoogleTokens } from '../../src/mail/google-auth.js';
import type { Mailer, OutgoingMail, SentMail } from '../../src/mail/mailer.js';

/** Test double: records what would be sent, never keeps the password. */
export class FakeMailer implements Mailer {
  sent: { config: MailSettings; mail: OutgoingMail }[] = [];
  failWith: AppError | null = null;
  delayMs = 0;
  /** Set to act like the Gmail API, which answers with a conversation id. */
  threadId: string | undefined;

  async send(config: MailSettings, _password: string, mail: OutgoingMail): Promise<SentMail> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failWith) throw this.failWith;
    this.sent.push({ config, mail });
    return { messageId: `<fake-${this.sent.length}@example.com>`, ...(this.threadId ? { threadId: this.threadId } : {}) };
  }
}

/** Test double for Google: never touches the network; records what the app asked of it. */
export class FakeGoogleAuth implements GoogleAuth {
  exchangeResult: GoogleTokens | AppError = { refreshToken: '1//fake-refresh', email: 'max@gmail.com' };
  accessTokenResult: string | AppError = 'ya29.fake-access';
  revokeFails = false;
  exchanges: { code: string; verifier: string; redirectUri: string }[] = [];
  revoked: string[] = [];
  authUrls: string[] = [];
  private counter = 0;

  async newVerifier(): Promise<{ verifier: string; challenge: string }> {
    this.counter += 1;
    return { verifier: `v-${this.counter}`, challenge: `c-${this.counter}` };
  }
  authUrl(o: { redirectUri: string; state: string; challenge: string; loginHint?: string }): string {
    const url = `https://accounts.example/auth?state=${o.state}&redirect_uri=${encodeURIComponent(o.redirectUri)}&code_challenge=${o.challenge}`;
    this.authUrls.push(url);
    return url;
  }
  async exchange(o: { code: string; verifier: string; redirectUri: string }): Promise<GoogleTokens> {
    this.exchanges.push(o);
    if (this.exchangeResult instanceof Error) throw this.exchangeResult;
    return this.exchangeResult;
  }
  async accessToken(): Promise<string> {
    if (this.accessTokenResult instanceof Error) throw this.accessTokenResult;
    return this.accessTokenResult;
  }
  async revoke(refreshToken: string): Promise<void> {
    this.revoked.push(refreshToken);
    if (this.revokeFails) throw new AppError('MAIL_CONNECT', 'fake revoke failure');
  }
}
