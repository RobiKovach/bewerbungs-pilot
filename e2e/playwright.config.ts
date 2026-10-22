import { defineConfig } from '@playwright/test';

// One run of the whole app (spec 0.9.0, 3.5): built server + web, scripted AI, mail to files, installed Edge.
export default defineConfig({
  testDir: '.',
  outputDir: '.out/results',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: '.out/report', open: 'never' }]],
  use: {
    channel: 'msedge',
    locale: 'en-US',
    actionTimeout: 20_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
