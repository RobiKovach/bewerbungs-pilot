/** Strict shapes of what the app sends (spec 0.11.0, 1.1): anything else is a 400, extra fields included. */

export const LANGUAGES = ['uk', 'en', 'de', 'ru', 'pl', 'ro'] as const;
export const KINDS = ['problem', 'idea'] as const;
export const MAX_TEXT = 5000;
export const MAX_EMAIL = 254;

export type Language = (typeof LANGUAGES)[number];
export type Kind = (typeof KINDS)[number];

export interface PingInput { installId: string; version: string }
export interface FeedbackInput { installId: string; version: string; language: Language; email: string; kind: Kind; text: string }

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEMVER = /^\d+\.\d+\.\d+$/;
// Deliberately simple: one @, no spaces or control characters, a dot in the domain.
const EMAIL = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u;

function exactKeys(body: unknown, keys: readonly string[]): body is Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const own = Object.keys(body);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

const isString = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

export function parsePing(body: unknown): PingInput | null {
  if (!exactKeys(body, ['installId', 'version'])) return null;
  const { installId, version } = body;
  if (!isString(installId, 36) || !UUID_V4.test(installId)) return null;
  if (!isString(version, 32) || !SEMVER.test(version)) return null;
  return { installId: installId.toLowerCase(), version };
}

export function parseFeedback(body: unknown): FeedbackInput | null {
  if (!exactKeys(body, ['installId', 'version', 'language', 'email', 'kind', 'text'])) return null;
  const ping = parsePing({ installId: body.installId, version: body.version });
  if (!ping) return null;
  const { language, email, kind, text } = body;
  if (!oneOf(LANGUAGES, language) || !oneOf(KINDS, kind)) return null;
  if (!isString(email, MAX_EMAIL) || !EMAIL.test(email.trim())) return null;
  // Characters, not UTF-16 units: 5 000 emoji are 5 000 characters.
  if (typeof text !== 'string' || text.trim() === '' || Array.from(text).length > MAX_TEXT) return null;
  return { ...ping, language, email: email.trim(), kind, text };
}
