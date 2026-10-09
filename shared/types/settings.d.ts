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

export interface Settings {
  schemaVersion: 1;
  language: Language | null;
  onboarding: { currentStep: string | null; completed: boolean };
  llm: { timeoutSec: number };
  vacancies: { publishedWithinDays: PublishedWithinDays };
  mail: MailSettings | null;
}

export interface SettingsPatch {
  language?: Language;
  onboarding?: Partial<Settings['onboarding']>;
  vacancies?: { publishedWithinDays: PublishedWithinDays };
}

export interface Availability { ok: boolean; reason?: 'not-installed' | 'not-logged-in' | 'error'; detail?: string }
export interface LlmCheck { availability: Availability; queue: { running: boolean; queued: number } }
