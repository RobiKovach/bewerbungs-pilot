import { startApp } from './server';

/** Starts one copy of the app for the whole run; the spec reads where it is from BP_E2E. Returns the teardown. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const app = await startApp();
  const { stop, ...env } = app;
  process.env.BP_E2E = JSON.stringify(env);
  return stop;
}
