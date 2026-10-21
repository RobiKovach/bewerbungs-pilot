import type { MailSettings } from '@bp/shared';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';
import type { GoogleAuth } from './google-auth.js';
import type { SecretStore } from './secret.js';

export interface RevokeDeps { secrets: SecretStore; googleAuth: GoogleAuth; logger: Logger; revokeTimeoutMs?: number }

/**
 * Takes back the saved Google key at Google (best effort; the caller removes it here anyway). Bounded: on a network that
 * silently drops packets the request never ends. Google revokes the whole grant of that account — so this must never
 * run for the account that was just signed in again. `mail` is the mailbox the saved key belongs to.
 */
export async function revokeGoogleKey(d: RevokeDeps, mail: MailSettings | null, reason: 'disconnect' | 'switch' | 'restore'): Promise<void> {
  if (mail?.kind !== 'google') return;
  const refreshToken = await d.secrets.load();
  if (refreshToken === null) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      d.googleAuth.revoke(refreshToken),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AppError('MAIL_CONNECT', 'google revoke timed out')), d.revokeTimeoutMs ?? 10_000);
      }),
    ]);
    if (reason !== 'disconnect') d.logger.info('google_revoked', { reason });
  } catch (err) {
    d.logger.warn('google_revoke_failed', { code: err instanceof AppError ? err.code : 'UNKNOWN', reason });
  } finally {
    clearTimeout(timer);
  }
}

/** "Disconnect" without touching settings: the key goes back to Google (best effort) and is deleted here always. */
export async function forgetMailbox(d: RevokeDeps, mail: MailSettings | null, reason: 'disconnect' | 'restore'): Promise<void> {
  await revokeGoogleKey(d, mail, reason);
  await d.secrets.remove();
}
