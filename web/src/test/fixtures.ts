import type { Settings, SettingsPatch } from '../types';
import type { RouteHandler } from './fetchMock';

export function baseSettings(over: Partial<Settings> = {}): Settings {
  return {
    schemaVersion: 4, language: 'en', onboarding: { currentStep: null, completed: true }, llm: { timeoutSec: 180, provider: 'claude' },
    vacancies: { publishedWithinDays: 14 }, mail: null, updates: { check: true, dismissedVersion: null }, backups: { folder: null }, ...over,
  };
}

// A tiny in-memory /api/settings that behaves like the real server.
export function settingsRoutes(initial: Settings) {
  let state = structuredClone(initial);
  const routes: Record<string, RouteHandler> = {
    'GET /api/settings': () => ({ body: state }),
    'PATCH /api/settings': (init) => {
      const p = JSON.parse(String(init?.body)) as SettingsPatch;
      state = {
        ...state, language: p.language ?? state.language, onboarding: { ...state.onboarding, ...p.onboarding },
        vacancies: p.vacancies ?? state.vacancies, llm: p.llm ? { ...state.llm, ...p.llm } : state.llm,
        updates: p.updates ? { ...state.updates, ...p.updates } : state.updates,
      };
      return { body: state };
    },
  };
  return { routes, current: () => state };
}
