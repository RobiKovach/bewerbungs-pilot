import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import type { ProfileView } from '../types';

interface ProfileCtx {
  view: ProfileView;
  /** Every profile endpoint answers with the whole view; components hand it here. */
  apply: (view: ProfileView) => void;
}

const Ctx = createContext<ProfileCtx | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [view, setView] = useState<ProfileView | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setView(await api.getProfile());
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorBanner error={error} onRetry={() => void load()} />;
  if (!view) return <p className="muted">{t('common.loading')}</p>;
  return <Ctx.Provider value={{ view, apply: setView }}>{children}</Ctx.Provider>;
}

export function useProfile(): ProfileCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}
