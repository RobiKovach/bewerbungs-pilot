import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { initI18n, setAiProvider } from '../i18n';

// Tests run as an existing user whose AI helper is Claude ({{ai}} = "Claude"), like baseSettings().
initI18n('en');
setAiProvider('claude');
afterEach(() => {
  cleanup();
  setAiProvider('claude');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = '';
});
