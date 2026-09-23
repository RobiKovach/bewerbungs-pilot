import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import i18n from 'i18next';
import { api } from './api';
import { ErrorBanner } from './components/ErrorBanner';
import { detectLanguage } from './i18n';
import type { Settings, SettingsPatch } from './types';

interface SettingsCtx {
  settings: Settings;
  update: (patch: SettingsPatch) => Promise<void>;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      let s = await api.getSettings();
      if (!s.language) {
        const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
        s = await api.patchSettings({ language: detectLanguage(candidates) });
      }
      await i18n.changeLanguage(s.language ?? 'en');
      setSettings(s);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = useCallback(async (patch: SettingsPatch) => {
    if (patch.language) await i18n.changeLanguage(patch.language);
    setSettings(await api.patchSettings(patch));
  }, []);

  if (error) return <div className="boot"><ErrorBanner error={error} onRetry={() => void load()} /></div>;
  if (!settings) return <div className="boot">{i18n.t('common.loading')}</div>;
  return <Ctx.Provider value={{ settings, update }}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
