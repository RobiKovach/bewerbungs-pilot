import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { AppError } from '../errors.js';
import { GOOGLE_CLIENT, GOOGLE_SCOPES } from './google-client.js';

export interface GoogleTokens { refreshToken: string; email: string }

export interface GoogleAuth {
  newVerifier(): Promise<{ verifier: string; challenge: string }>;
  authUrl(o: { redirectUri: string; state: string; challenge: string; loginHint?: string }): string;
  exchange(o: { code: string; verifier: string; redirectUri: string }): Promise<GoogleTokens>;
  accessToken(refreshToken: string): Promise<string>;
  revoke(refreshToken: string): Promise<void>;
}

const REAUTH_WORDS = new Set(['invalid_grant', 'unauthorized_client', 'invalid_client']);

/**
 * invalid_grant / unauthorized_client / 401 → MAIL_REAUTH; no network / 5xx / 429 / anything else → MAIL_CONNECT.
 * The detail is the status and Google's error word only: never `message`, never `error_description`.
 */
export function googleErrorFrom(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = (typeof err === 'object' && err !== null ? err : {}) as {
    code?: unknown; response?: { status?: unknown; data?: { error?: unknown } };
  };
  const status = typeof e.response?.status === 'number' ? e.response.status : 0;
  const word = (typeof e.response?.data?.error === 'string' ? e.response.data.error
    : typeof e.code === 'string' ? e.code : '').toLowerCase().replace(/[^a-z_]/g, '').slice(0, 40);
  const detail = `google ${status || ''} ${word}`.replace(/\s+/g, ' ').trim();
  const reauth = REAUTH_WORDS.has(word) || status === 401;
  return new AppError(reauth ? 'MAIL_REAUTH' : 'MAIL_CONNECT', detail);
}

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/**
 * Google lets the person untick single permissions; the token answer lists what was granted (space-separated).
 * No list at all is not treated as a refusal — sending itself would still report a missing permission.
 */
export function grantsSending(scope: string | null | undefined): boolean {
  if (typeof scope !== 'string' || scope.trim() === '') return true;
  return scope.split(/\s+/).includes(SEND_SCOPE);
}

export class LibraryGoogleAuth implements GoogleAuth {
  constructor(private readonly client: { id: string; secret: string } = GOOGLE_CLIENT) {}

  private oauth(): OAuth2Client {
    return new OAuth2Client({ clientId: this.client.id, clientSecret: this.client.secret, transporterOptions: { timeout: 30_000 } });
  }

  async newVerifier(): Promise<{ verifier: string; challenge: string }> {
    const r = await this.oauth().generateCodeVerifierAsync();
    return { verifier: r.codeVerifier, challenge: r.codeChallenge as string };
  }

  authUrl(o: { redirectUri: string; state: string; challenge: string; loginHint?: string }): string {
    return this.oauth().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [...GOOGLE_SCOPES],
      state: o.state,
      redirect_uri: o.redirectUri,
      code_challenge_method: CodeChallengeMethod.S256,
      code_challenge: o.challenge,
      ...(o.loginHint ? { login_hint: o.loginHint } : {}),
    });
  }

  async exchange(o: { code: string; verifier: string; redirectUri: string }): Promise<GoogleTokens> {
    try {
      const client = this.oauth();
      const { tokens } = await client.getToken({ code: o.code, codeVerifier: o.verifier, redirect_uri: o.redirectUri });
      if (!tokens.refresh_token || !tokens.id_token) throw new AppError('MAIL_CONNECT', 'google returned no refresh token');
      if (!grantsSending(tokens.scope)) {
        // The person left "send email" unticked on Google's page: this key cannot send, so it is not kept.
        void client.revokeToken(tokens.refresh_token).catch(() => undefined);
        throw new AppError('MAIL_SCOPE', 'gmail.send not granted');
      }
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: this.client.id });
      const payload = ticket.getPayload();
      if (!payload?.email || payload.email_verified === false) throw new AppError('MAIL_CONNECT', 'google returned no verified email');
      return { refreshToken: tokens.refresh_token, email: payload.email };
    } catch (err) {
      throw googleErrorFrom(err);
    }
  }

  async accessToken(refreshToken: string): Promise<string> {
    try {
      const c = this.oauth();
      c.setCredentials({ refresh_token: refreshToken });
      const { token } = await c.getAccessToken();
      if (!token) throw new AppError('MAIL_REAUTH', 'google returned no access token');
      return token;
    } catch (err) {
      throw googleErrorFrom(err);
    }
  }

  async revoke(refreshToken: string): Promise<void> {
    try {
      await this.oauth().revokeToken(refreshToken);
    } catch (err) {
      throw googleErrorFrom(err);
    }
  }
}
