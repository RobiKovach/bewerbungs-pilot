import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { initI18n, setAiProvider } from '../i18n';

// Tests run as an existing user whose AI helper is Claude ({{ai}} = "Claude"), like baseSettings().
initI18n('en');
setAiProvider('claude');
// Waiting for an element: 1 s (the default) is too short on a busy CI runner.
configure({ asyncUtilTimeout: 5000 });
// jsdom has no scrolling: without this each move between screens prints "Not implemented".
window.scrollTo = () => {};
afterEach(() => {
  cleanup();
  setAiProvider('claude');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = '';
});
