import { useEffect, useState } from 'react';
import { api } from './api';
import { Layout } from './components/Layout';
import { confirmLeave, setUnsaved } from './leaveGuard';
import { OnboardingWizard } from './onboarding/OnboardingWizard';
import { UnsavedProvider } from './profile/unsaved';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { GuidePage } from './pages/GuidePage';
import { HomePage } from './pages/HomePage';
import { ProfilePage } from './pages/ProfilePage';
import { QuitScreen } from './pages/QuitScreen';
import { SettingsPage } from './pages/SettingsPage';
import { VacanciesPage } from './pages/VacanciesPage';
import { useSettings } from './settings';
import type { Route } from './types';

function routeFromHash(hash: string): Route {
  const r = hash.replace(/^#\/?/, '');
  if (r === 'applications' || r.startsWith('applications/')) return 'applications';
  return r === 'guide' || r === 'settings' || r === 'profile' || r === 'vacancies' ? r : 'home';
}

export function App() {
  const { settings } = useSettings();
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));
  const [quit, setQuit] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (quit) return <QuitScreen />;
  const onQuit = async () => {
    if (!confirmLeave()) return;
    await api.shutdown().catch(() => undefined);
    setQuit(true);
  };
  const onboarding = !settings.onboarding.completed;
  let page = <HomePage />;
  if (onboarding) page = <OnboardingWizard />;
  else if (route === 'guide') page = <GuidePage />;
  else if (route === 'settings') page = <SettingsPage onQuit={() => void onQuit()} />;
  else if (route === 'profile') page = <ProfilePage />;
  else if (route === 'vacancies') page = <VacanciesPage />;
  else if (route === 'applications') page = <ApplicationsPage />;
  return (
    // App-wide: any form with unsaved changes makes leaving it (page, language, Quit, closing the tab) ask first.
    <UnsavedProvider onChange={setUnsaved}>
      <Layout route={route} onQuit={() => void onQuit()} showNav={!onboarding}>
        {page}
      </Layout>
    </UnsavedProvider>
  );
}
