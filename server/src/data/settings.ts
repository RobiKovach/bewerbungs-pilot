import fs from 'node:fs';
import path from 'node:path';
import type { Language, MailSettings, ProviderId, PublishedWithinDays, Settings, SettingsPatch } from '@bp/shared';
import { DRIVE_PATH } from '../backup/folder.js';
import { AppError } from '../errors.js';
import { CorruptJsonError, readJson, writeJsonAtomic } from './atomic.js';

export type { Language, ProviderId, Settings, SettingsPatch };

export const SUPPORTED_LANGUAGES = ['uk', 'en', 'de', 'ru', 'pl', 'ro'] as const satisfies readonly Language[];

export const PUBLISHED_WITHIN_DAYS = [1, 3, 7, 14, 30] as const satisfies readonly PublishedWithinDays[];

export const PROVIDER_IDS = ['claude', 'chatgpt'] as const satisfies readonly ProviderId[];

/** Onboarding step ids in order — the same list as web/src/onboarding/steps.ts (a server test keeps them in sync;
 *  0.7.x used the same ids and order). */
export const ONBOARDING_STEP_ORDER = ['welcome', 'claude', 'profile', 'email', 'done'] as const;
/** v1 (0.7.x) people at one of these steps had already passed the Claude check — the 0.7.x installer always set up Claude. */
const STEPS_AFTER_CLAUDE: readonly string[] = ONBOARDING_STEP_ORDER.slice(ONBOARDING_STEP_ORDER.indexOf('claude') + 1);

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 4,
  language: null,
  onboarding: { currentStep: null, completed: false },
  llm: { timeoutSec: 180, provider: null },
  vacancies: { publishedWithinDays: 14 },
  mail: null,
  updates: { check: true, dismissedVersion: null },
  backups: { folder: null },
};

/** A chosen backup folder as stored: an absolute path on a drive letter (off Windows, where tests run: any absolute path). */
const isLocalAbsolute = (p: string) => DRIVE_PATH.test(p) || (process.platform !== 'win32' && path.isAbsolute(p));

type Warn =(event: string, data: Record<string, unknown>) => void;

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
      llm: { ...this.current.llm, ...(p.llm ?? {}) },
      vacancies: { ...this.current.vacancies, ...p.vacancies },
      updates: { ...this.current.updates, ...(p.updates ?? {}) },
    };
    return this.save(next);
  }

  setMail(mail: MailSettings | null): Settings {
    return this.save({ ...this.current, mail: mail ? { ...mail } : null });
  }

  /** null = automatic (see backup/folder.ts); the route checks the folder before it is saved. */
  setBackupFolder(folder: string | null): Settings {
    return this.save({ ...this.current, backups: { folder } });
  }

  /** × on the update banner: hidden for this version only, the next one shows again. */
  dismissUpdate(version: string): Settings {
    return this.save({ ...this.current, updates: { ...this.current.updates, dismissedVersion: version } });
  }

  private save(next: Settings): Settings {
    try {
      writeJsonAtomic(this.file, next);
    } catch (err) {
      throw new AppError('DATA_WRITE_FAILED', String(err));
    }
    this.current = next;
    return this.get();
  }
}

function normalizeMail(raw: unknown): MailSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const { kind, address, senderName, host, port, security, user, provider } = raw as Record<string, unknown>;
  if (kind === 'google') {
    if (typeof address !== 'string' || typeof senderName !== 'string') return null;
    return { kind: 'google', address, senderName, provider: 'gmail' };
  }
  if (kind !== undefined && kind !== 'smtp') return null;
  if (typeof address !== 'string' || typeof senderName !== 'string' || typeof host !== 'string' || typeof user !== 'string' || typeof provider !== 'string') return null;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (security !== 'ssl' && security !== 'starttls') return null;
  return { kind: 'smtp', address, senderName, host, port, security, user, provider };
}

function normalize(raw: unknown): Settings {
  const d = structuredClone(DEFAULT_SETTINGS);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as {
    schemaVersion?: unknown;
    language?: unknown;
    onboarding?: { currentStep?: unknown; completed?: unknown };
    llm?: { timeoutSec?: unknown; provider?: unknown };
    vacancies?: { publishedWithinDays?: unknown };
    mail?: unknown;
    updates?: { check?: unknown; dismissedVersion?: unknown };
    backups?: { folder?: unknown };
  };
  const lang = SUPPORTED_LANGUAGES.find((l) => l === r.language) ?? null;
  const timeout = r.llm?.timeoutSec;
  const provider: ProviderId | null = PROVIDER_IDS.find((id) => id === r.llm?.provider)
    // v1 files (schemaVersion missing or 1) predate the choice: everyone who finished onboarding — or got past the Claude step — used Claude.
    ?? (r.schemaVersion !== 2 && r.schemaVersion !== 3 && r.schemaVersion !== 4 && (r.onboarding?.completed === true
      || (typeof r.onboarding?.currentStep === 'string' && STEPS_AFTER_CLAUDE.includes(r.onboarding.currentStep))) ? 'claude' : null);
  const dismissed = r.updates?.dismissedVersion;
  const folder = r.backups?.folder;
  return {
    schemaVersion: 4,
    language: lang,
    onboarding: {
      currentStep: typeof r.onboarding?.currentStep === 'string' ? r.onboarding.currentStep : null,
      completed: r.onboarding?.completed === true,
    },
    llm: { timeoutSec: typeof timeout === 'number' && timeout >= 30 ? timeout : d.llm.timeoutSec, provider },
    vacancies: {
      publishedWithinDays: PUBLISHED_WITHIN_DAYS.find((n) => n === r.vacancies?.publishedWithinDays) ?? d.vacancies.publishedWithinDays,
    },
    mail: normalizeMail(r.mail),
    // v2 → v3: the check is on unless someone switched it off.
    updates: {
      check: r.updates?.check !== false,
      dismissedVersion: typeof dismissed === 'string' && /^\d+\.\d+\.\d+$/.test(dismissed) ? dismissed : null,
    },
    // v3 → v4: automatic. A hand-edited relative or network path is dropped too (the installer ignores it the same way).
    backups: { folder: typeof folder === 'string' && isLocalAbsolute(folder) ? folder : null },
  };
}
