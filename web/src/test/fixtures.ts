import type { Settings, SettingsPatch } from '../types';
import type { RouteHandler } from './fetchMock';

export function baseSettings(over: Partial<Settings> = {}): Settings {
  return { schemaVersion: 1, language: 'en', onboarding: { currentStep: null, completed: true }, llm: { timeoutSec: 180 }, ...over };
}

// A tiny in-memory /api/settings that behaves like the real server.
export function settingsRoutes(initial: Settings) {
  let state = structuredClone(initial);
  const routes: Record<string, RouteHandler> = {
    'GET /api/settings': () => ({ body: state }),
    'PATCH /api/settings': (init) => {
      const p = JSON.parse(String(init?.body)) as SettingsPatch;
      state = { ...state, language: p.language ?? state.language, onboarding: { ...state.onboarding, ...p.onboarding } };
      return { body: state };
    },
  };
  return { routes, current: () => state };
}
