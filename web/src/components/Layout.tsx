import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Route } from '../types';
import { DemoBanner } from './DemoBanner';
import { LanguageSwitcher } from './LanguageSwitcher';
import { TryDemoButton } from './TryDemoButton';
import { UpdateBanner } from './UpdateBanner';

const ROUTES: Route[] = ['home', 'profile', 'vacancies', 'applications', 'guide', 'settings'];

export function Layout({ route, onQuit, showNav, demo = false, onLeaveDemo, children }: {
  route: Route; onQuit: () => void; showNav: boolean; demo?: boolean; onLeaveDemo?: () => void; children: ReactNode;
}) {
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
          {/* After setup the real app keeps offering the demo (during setup it sits on the first step). */}
          {showNav && !demo ? <TryDemoButton /> : null}
          <LanguageSwitcher />
          <button type="button" className="btn ghost" onClick={onQuit}>{t('nav.quit')}</button>
        </div>
      </header>
      {demo ? <DemoBanner onLeave={onLeaveDemo ?? onQuit} /> : null}
      <UpdateBanner />
      <main className="content">{children}</main>
    </div>
  );
}
