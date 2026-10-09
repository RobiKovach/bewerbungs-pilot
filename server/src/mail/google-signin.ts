import crypto from 'node:crypto';
import type { GoogleSignInStatus } from '@bp/shared';
import { AppError, type ErrorCode } from '../errors.js';
import type { GoogleAuth, GoogleTokens } from './google-auth.js';

export const SIGNIN_TTL_MS = 10 * 60_000;

type Phase = 'pending' | 'ready' | 'cancelled' | 'failed';

interface Attempt {
  state: string;
  verifier: string;
  redirectUri: string;
  startedAt: number;
  phase: Phase;
  /** The code exchange is running (the attempt still shows as `pending`; a second callback is `unknown`). */
  exchanging: boolean;
  tokens?: GoogleTokens;
  code?: ErrorCode;
}

/**
 * One "Sign in with Google" attempt at a time, kept in memory only. The refresh token lives here until the
 * person has saved the account; `status()` never contains it.
 */
export class GoogleSignIn {
  private attempt: Attempt | null = null;

  constructor(private readonly auth: GoogleAuth, private readonly now: () => number = Date.now) {}

  /** A new attempt replaces any old one. Returns the Google address to open. */
  async start(redirectUri: string, loginHint?: string): Promise<string> {
    const { verifier, challenge } = await this.auth.newVerifier();
    const state = crypto.randomBytes(24).toString('base64url');
    this.attempt = { state, verifier, redirectUri, startedAt: this.now(), phase: 'pending', exchanging: false };
    return this.auth.authUrl({ redirectUri, state, challenge, ...(loginHint ? { loginHint } : {}) });
  }

  async callback(q: { state?: string; code?: string; error?: string }): Promise<'ready' | 'cancelled' | 'failed' | 'unknown'> {
    const a = this.attempt;
    this.expire();
    if (!a || this.attempt !== a || q.state !== a.state || a.phase !== 'pending' || a.exchanging) return 'unknown';
    if (q.error) { a.phase = 'cancelled'; return 'cancelled'; }
    if (!q.code) { a.phase = 'failed'; a.code = 'BAD_REQUEST'; return 'failed'; }
    a.exchanging = true;
    try {
      const tokens = await this.auth.exchange({ code: q.code, verifier: a.verifier, redirectUri: a.redirectUri });
      if (this.attempt !== a) return 'unknown'; // a newer "Sign in" replaced this attempt meanwhile
      a.tokens = tokens;
      a.phase = 'ready';
      return 'ready';
    } catch (err) {
      if (this.attempt !== a) return 'unknown';
      a.phase = 'failed';
      // An expired or already used code is `invalid_grant` (MAIL_REAUTH) — "sign in again" would be a confusing
      // message here, so a failed exchange always reports a connection problem; the page just says it did not work.
      const code = err instanceof AppError ? err.code : 'MAIL_CONNECT';
      a.code = code === 'MAIL_REAUTH' ? 'MAIL_CONNECT' : code;
      return 'failed';
    } finally {
      a.exchanging = false;
    }
  }

  status(): GoogleSignInStatus {
    this.expire();
    const a = this.attempt;
    if (!a) return { state: 'idle' };
    if (a.phase === 'ready') return { state: 'ready', email: a.tokens!.email };
    if (a.phase === 'failed') return { state: 'failed', code: a.code! };
    return { state: a.phase };
  }

  tokens(): GoogleTokens | null {
    this.expire();
    return this.attempt?.phase === 'ready' ? (this.attempt.tokens ?? null) : null;
  }

  clear(): void {
    this.attempt = null;
  }

  /** A `pending` attempt older than the time limit counts as cancelled (and can no longer be completed). */
  private expire(): void {
    const a = this.attempt;
    if (a && a.phase === 'pending' && !a.exchanging && this.now() - a.startedAt > SIGNIN_TTL_MS) a.phase = 'cancelled';
  }
}
