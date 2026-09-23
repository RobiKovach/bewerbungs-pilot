import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initI18n } from './i18n';
import { SettingsProvider } from './settings';
import './styles.css';

initI18n('en');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </React.StrictMode>,
);
