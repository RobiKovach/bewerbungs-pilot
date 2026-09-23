import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors.js';
import { CorruptJsonError, readJson, writeJsonAtomic } from './atomic.js';

export const SUPPORTED_LANGUAGES = ['uk', 'en', 'de', 'ru', 'pl', 'ro'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export interface Settings {
  schemaVersion: 1;
  language: Language | null;
  onboarding: { currentStep: string | null; completed: boolean };
  llm: { timeoutSec: number };
}

export interface SettingsPatch {
  language?: Language;
  onboarding?: Partial<Settings['onboarding']>;
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  language: null,
  onboarding: { currentStep: null, completed: false },
  llm: { timeoutSec: 180 },
};

type Warn = (event: string, data: Record<string, unknown>) => void;

export class SettingsStore {
  private current: Settings = structuredClone(DEFAULT_SETTINGS);

  constructor(private readonly file: string, private readonly warn: Warn = () => {}) {}

  load(): Settings {
    let raw: unknown = null;
    try {
      raw = readJson<unknown>(this.file);
    } catch (err) {
      if (!(err instanceof CorruptJsonError)) throw err;
      const backup = path.join(path.dirname(this.file), `settings.corrupt-${Date.now()}.json`);
      fs.renameSync(this.file, backup);
      this.warn('settings_corrupt', { backup });
    }
    this.current = normalize(raw);
    return this.get();
  }

  get(): Settings {
    return structuredClone(this.current);
  }

  patch(p: SettingsPatch): Settings {
    const next: Settings = {
      ...this.current,
      language: p.language ?? this.current.language,
      onboarding: { ...this.current.onboarding, ...p.onboarding },
    };
    try {
      writeJsonAtomic(this.file, next);
    } catch (err) {
      throw new AppError('DATA_WRITE_FAILED', String(err));
    }
    this.current = next;
    return this.get();
  }
}

function normalize(raw: unknown): Settings {
  const d = structuredClone(DEFAULT_SETTINGS);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as { language?: unknown; onboarding?: { currentStep?: unknown; completed?: unknown }; llm?: { timeoutSec?: unknown } };
  const lang = SUPPORTED_LANGUAGES.find((l) => l === r.language) ?? null;
  const timeout = r.llm?.timeoutSec;
  return {
    schemaVersion: 1,
    language: lang,
    onboarding: {
      currentStep: typeof r.onboarding?.currentStep === 'string' ? r.onboarding.currentStep : null,
      completed: r.onboarding?.completed === true,
    },
    llm: { timeoutSec: typeof timeout === 'number' && timeout >= 30 ? timeout : d.llm.timeoutSec },
  };
}
