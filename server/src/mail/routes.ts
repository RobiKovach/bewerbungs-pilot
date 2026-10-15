import type { FastifyInstance } from 'fastify';
import type { Language, MailSecurity, MailSettings, MailSettingsView } from '@bp/shared';
import { SUPPORTED_LANGUAGES, type SettingsStore } from '../data/settings.js';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';
import { testMail } from './compose.js';
import type { GoogleAuth } from './google-auth.js';
import { callbackPage } from './google-page.js';
import { GoogleSignIn } from './google-signin.js';
import type { Mailer } from './mailer.js';
import { MAIL_PROVIDERS, providerFor } from './providers.js';
import type { SecretStore } from './secret.js';

export interface MailRouteDeps { settings: SettingsStore; mailer: Mailer; secrets: SecretStore; logger: Logger;
  googleAuth: GoogleAuth; origin: () => string; revokeTimeoutMs?: number }

/** One line of text: at least one character, no CR/LF anywhere (header injection). */
const line = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength, pattern: '^[^\r\n]+$' });

const putSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['address', 'senderName', 'host', 'port', 'security', 'user', 'language'],
  properties: {
    address: line(254),
    senderName: line(100),
    host: { type: 'string', pattern: '^[A-Za-z0-9.-]{1,253}$' },
    port: { type: 'integer', minimum: 1, maximum: 65535 },
    security: { type: 'string', enum: ['ssl', 'starttls'] },
    user: line(254),
    password: line(500),
    language: { type: 'string', enum: [...SUPPORTED_LANGUAGES] },
  },
} as const;

const startSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { address: { type: 'string', maxLength: 254, pattern: '^[^\r\n]*$' } },
} as const;

const saveSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['senderName', 'language'],
  properties: { senderName: line(100), language: { type: 'string', enum: [...SUPPORTED_LANGUAGES] } },
} as const;

interface PutBody {
  address: string; senderName: string; host: string; port: number; security: MailSecurity;
  user: string; password?: string; language: Language;
}

export async function registerMailRoutes(app: FastifyInstance, deps: MailRouteDeps): Promise<void> {
  const view = async (): Promise<MailSettingsView> => ({
    mail: deps.settings.get().mail,
    passwordSaved: (await deps.secrets.load()) !== null,
  });

  app.get('/api/mail/settings', async () => view());
  app.get('/api/mail/providers', async () => MAIL_PROVIDERS);

  app.put('/api/mail/settings', { schema: { body: putSchema } }, async (req) => {
    const b = req.body as PutBody;
    if (!/^[^@\s]+@[^@\s]+$/.test(b.address)) throw new AppError('BAD_REQUEST', 'address is not an email address');
    // A saved secret is reusable only when it is an SMTP password: a Google refresh token must never go to an SMTP server.
    const password = b.password ?? (deps.settings.get().mail?.kind === 'smtp' ? await deps.secrets.load() : null);
    if (password === null) throw new AppError('MAIL_NOT_CONFIGURED', 'no password saved');
    const config: MailSettings = {
      kind: 'smtp', address: b.address, senderName: b.senderName, host: b.host, port: b.port, security: b.security,
      user: b.user, provider: providerFor(b.address)?.id ?? 'other',
    };
    const { subject, text } = testMail(b.language);
    try {
      await deps.mailer.send(config, password, {
        from: { name: b.senderName, address: b.address }, to: b.address, subject, text, attachments: [],
      });
    } catch (err) {
      deps.logger.warn('mail_test', { result: err instanceof AppError ? err.code : 'UNKNOWN' });
      throw err;
    }
    deps.logger.info('mail_test', { result: 'ok' });
    if (b.password !== undefined) await deps.secrets.save(b.password);
    deps.settings.setMail(config);
    return view();
  });

  app.delete('/api/mail/settings', async () => {
    if (deps.settings.get().mail?.kind === 'google') {
      const refreshToken = await deps.secrets.load();
      if (refreshToken !== null) {
        // Bounded: on a network that silently drops packets the request never ends, and the key would stay.
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            deps.googleAuth.revoke(refreshToken),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new AppError('MAIL_CONNECT', 'google revoke timed out')), deps.revokeTimeoutMs ?? 10_000);
            }),
          ]);
        } catch (err) {
          deps.logger.warn('google_revoke_failed', { code: err instanceof AppError ? err.code : 'UNKNOWN' });
        } finally {
          clearTimeout(timer);
        }
      }
    }
    deps.settings.setMail(null);
    await deps.secrets.remove();
    return view();
  });

  const signIn = new GoogleSignIn(deps.googleAuth);

  app.post('/api/mail/google/start', { schema: { body: startSchema } }, async (req) => {
    const address = (req.body as { address?: string } | null)?.address;
    const url = await signIn.start(`${deps.origin()}/oauth/google/callback`, address?.includes('@') ? address : undefined);
    deps.logger.info('google_signin_start');
    return { url };
  });

  app.get('/api/mail/google/status', async () => signIn.status());

  app.get('/oauth/google/callback', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const result = await signIn.callback({ state: str(q.state), code: str(q.code), error: str(q.error) });
    deps.logger.info('google_signin_result', { result });
    return reply.type('text/html; charset=utf-8').send(callbackPage(deps.settings.get().language ?? 'en', result));
  });

  app.post('/api/mail/google/save', { schema: { body: saveSchema } }, async (req) => {
    const b = req.body as { senderName: string; language: Language };
    const tokens = signIn.tokens();
    if (!tokens) throw new AppError('CONFLICT', 'google sign-in is not finished', 'googleNotSignedIn');
    const config: MailSettings = { kind: 'google', address: tokens.email, senderName: b.senderName, provider: 'gmail' };
    const { subject, text } = testMail(b.language);
    try {
      await deps.mailer.send(config, tokens.refreshToken, {
        from: { name: b.senderName, address: tokens.email }, to: tokens.email, subject, text, attachments: [],
      });
    } catch (err) {
      deps.logger.warn('mail_test', { result: err instanceof AppError ? err.code : 'UNKNOWN' });
      // The "send email" permission was not given: saving again with the same key cannot help — the sign-in is
      // dropped, "Try again" starts a new one.
      if (err instanceof AppError && err.code === 'MAIL_SCOPE') signIn.clear();
      throw err;
    }
    deps.logger.info('mail_test', { result: 'ok' });
    await deps.secrets.save(tokens.refreshToken);
    deps.settings.setMail(config);
    signIn.clear();
    return view();
  });
}
