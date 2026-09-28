import type { PublishedWithinDays } from './vacancy.js';

export type Language = 'uk' | 'en' | 'de' | 'ru' | 'pl' | 'ro';

export interface Settings {
  schemaVersion: 1;
  language: Language | null;
  onboarding: { currentStep: string | null; completed: boolean };
  llm: { timeoutSec: number };
  vacancies: { publishedWithinDays: PublishedWithinDays };
}

export interface SettingsPatch {
  language?: Language;
  onboarding?: Partial<Settings['onboarding']>;
  vacancies?: { publishedWithinDays: PublishedWithinDays };
}

export interface Availability { ok: boolean; reason?: 'not-installed' | 'not-logged-in' | 'error'; detail?: string }
export interface LlmCheck { availability: Availability; queue: { running: boolean; queued: number } }
