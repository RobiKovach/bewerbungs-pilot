import { useEffect, useState, type ReactNode } from 'react';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import { onNoSession } from './api';
import { detectLanguage } from './i18n';
import type { Language } from './types';

/** The settings (and so the chosen language) cannot be read without the launch key: use the browser's language. */
export function pickBrowserLanguage(langs: readonly string[]): Language {
  return detectLanguage(langs);
}

function NoSessionScreen() {
  const { t } = useTranslation();
  return (
    <div className="boot">
      <div className="card">
        <h1>{t('noSession.title')}</h1>
        <p>{t('noSession.text')}</p>
      </div>
    </div>
  );
}

/**
 * Outermost wrapper: once any request comes back NO_SESSION (opened from a bookmark after a restart, or the key
 * changed), the whole app is replaced by the "open via shortcut" screen — no menu, no data, no retry loop.
 */
export function NoSessionGate({ children }: { children: ReactNode }) {
  const [lost, setLost] = useState(false);

  useEffect(() => onNoSession(() => {
    const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
    void i18n.changeLanguage(pickBrowserLanguage(candidates));
    setLost(true);
  }), []);

  return lost ? <NoSessionScreen /> : <>{children}</>;
}
