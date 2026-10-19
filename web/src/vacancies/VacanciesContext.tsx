import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import type { Vacancy, WishesData } from '../types';

export interface VacanciesCtx {
  vacancies: Vacancy[];
  wishes: WishesData;
  reload: () => Promise<void>;
  /** Puts a changed card from a server answer into the list (adds it if new). */
  put: (v: Vacancy) => void;
  /** Saves the job wishes to the profile (the search strip edits job titles in place); throws on failure. */
  saveWishes: (w: WishesData) => Promise<void>;
}

const Ctx = createContext<VacanciesCtx | null>(null);

export function VacanciesProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [vacancies, setVacancies] = useState<Vacancy[] | null>(null);
  const [wishes, setWishes] = useState<WishesData | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    try {
      const [list, profile] = await Promise.all([api.listVacancies(), api.getProfile()]);
      setVacancies(list.vacancies);
      setWishes(profile.profile.sections.wishes.data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const put = useCallback((v: Vacancy) => {
    setVacancies((list) => {
      const current = list ?? [];
      return current.some((x) => x.id === v.id) ? current.map((x) => (x.id === v.id ? v : x)) : [...current, v];
    });
  }, []);

  const saveWishes = useCallback(async (w: WishesData) => {
    const view = await api.saveSection('wishes', w);
    setWishes(view.profile.sections.wishes.data);
  }, []);

  if (error && !vacancies) return <ErrorBanner error={error} onRetry={() => void reload()} />;
  if (!vacancies || !wishes) return <p className="muted">{t('common.loading')}</p>;
  return <Ctx.Provider value={{ vacancies, wishes, reload, put, saveWishes }}>{children}</Ctx.Provider>;
}

export function useVacancies(): VacanciesCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVacancies must be used inside VacanciesProvider');
  return ctx;
}
