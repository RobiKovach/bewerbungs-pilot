import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initI18n } from './i18n';
import { installLeaveGuard } from './leaveGuard';
import { NoSessionGate } from './NoSessionGate';
import { SettingsProvider } from './settings';
import './styles.css';

initI18n('en');
installLeaveGuard(); // before the app, so its hashchange listener runs first
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NoSessionGate>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </NoSessionGate>
  </React.StrictMode>,
);
