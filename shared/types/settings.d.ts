import type { ErrorCode } from './errors.js';
import type { PublishedWithinDays } from './vacancy.js';

export type Language = 'uk' | 'en' | 'de' | 'ru' | 'pl' | 'ro';

export type MailSecurity = 'ssl' | 'starttls';
export interface SmtpMailSettings { kind: 'smtp'; address: string; senderName: string; host: string; port: number; security: MailSecurity; user: string; provider: string }
export interface GoogleMailSettings { kind: 'google'; address: string; senderName: string; provider: 'gmail' }
export type MailSettings = SmtpMailSettings | GoogleMailSettings;
export interface MailProvider { id: string; label: string; domains: string[]; host: string; port: number; security: MailSecurity; helpUrl: string }
export interface GoogleSignInStatus { state: 'idle' | 'pending' | 'ready' | 'cancelled' | 'failed'; email?: string; code?: ErrorCode }
export interface MailSettingsView { mail: MailSettings | null; passwordSaved: boolean }

export type ProviderId = 'claude' | 'chatgpt';

export interface Settings {
  schemaVersion: 4;
  language: Language | null;
  onboarding: { currentStep: string | null; completed: boolean };
  llm: { timeoutSec: number; provider: ProviderId | null };
  vacancies: { publishedWithinDays: PublishedWithinDays };
  mail: MailSettings | null;
  /** Daily look at our version.json (spec 0.9.0); dismissedVersion = the version whose banner was closed with ×. */
  updates: { check: boolean; dismissedVersion: string | null };
  /** folder null = automatic (Documents, or a local folder when Documents is in OneDrive); set via PUT /api/backups/folder. */
  backups: { folder: string | null };
}

export interface SettingsPatch {
  language?: Language;
  onboarding?: Partial<Settings['onboarding']>;
  vacancies?: { publishedWithinDays: PublishedWithinDays };
  llm?: { provider: ProviderId };
  updates?: { check: boolean };
}

/** GET /api/updates: notes already in the UI language (English fallback); available null = no banner. */
export interface UpdatesView { current: string; available: { version: string; url: string; notes: string } | null }

export interface Availability { ok: boolean; reason?: 'not-installed' | 'not-logged-in' | 'error'; detail?: string }
/** provider null = none chosen yet (availability is then { ok: false, reason: 'error' }). */
export interface LlmCheck { provider: ProviderId | null; availability: Availability; queue: { running: boolean; queued: number } }
export interface InstallStatus { state: 'idle' | 'running' | 'done' | 'failed'; provider: ProviderId | null; detail?: string }
