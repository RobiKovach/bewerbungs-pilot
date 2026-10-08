import type { FastifyInstance } from 'fastify';
import type { Language, MailSecurity, MailSettings, MailSettingsView } from '@bp/shared';
import { SUPPORTED_LANGUAGES, type SettingsStore } from '../data/settings.js';
import { AppError } from '../errors.js';
import type { Logger } from '../log.js';
import { testMail } from './compose.js';
import type { Mailer } from './mailer.js';
import { MAIL_PROVIDERS, providerFor } from './providers.js';
import type { SecretStore } from './secret.js';

export interface MailRouteDeps { settings: SettingsStore; mailer: Mailer; secrets: SecretStore; logger: Logger }

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
    const password = b.password ?? (await deps.secrets.load());
    if (password === null) throw new AppError('MAIL_NOT_CONFIGURED', 'no password saved');
    const config: MailSettings = {
      address: b.address, senderName: b.senderName, host: b.host, port: b.port, security: b.security,
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
    deps.settings.setMail(null);
    await deps.secrets.remove();
    return view();
  });
}
