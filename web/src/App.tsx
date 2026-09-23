import { useEffect, useState } from 'react';
import { api } from './api';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { QuitScreen } from './pages/QuitScreen';
import type { Route } from './types';

function routeFromHash(hash: string): Route {
  const r = hash.replace(/^#\/?/, '');
  return r === 'guide' || r === 'settings' ? r : 'home';
}

export function App() {
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash));
  const [quit, setQuit] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (quit) return <QuitScreen />;
  const onQuit = async () => {
    await api.shutdown().catch(() => undefined);
    setQuit(true);
  };
  return (
    <Layout route={route} onQuit={() => void onQuit()} showNav>
      <HomePage />
    </Layout>
  );
}
