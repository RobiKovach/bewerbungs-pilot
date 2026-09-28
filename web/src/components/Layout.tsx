import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Route } from '../types';
import { LanguageSwitcher } from './LanguageSwitcher';

const ROUTES: Route[] = ['home', 'profile', 'vacancies', 'guide', 'settings'];

export function Layout({ route, onQuit, showNav, children }: { route: Route; onQuit: () => void; showNav: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">✈</span>{t('app.name')}</div>
        {showNav ? (
          <nav className="nav">
            {ROUTES.map((r) => (
              <a key={r} href={r === 'home' ? '#/' : `#/${r}`} className={r === route ? 'active' : undefined} aria-current={r === route ? 'page' : undefined}>
                {t(`nav.${r}`)}
              </a>
            ))}
          </nav>
        ) : null}
        <div className="topbar-actions">
          <LanguageSwitcher />
          <button type="button" className="btn ghost" onClick={onQuit}>{t('nav.quit')}</button>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
