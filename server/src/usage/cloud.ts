import type { Logger } from '../log.js';
import { devUpdateSourceAllowed } from '../updates/updater.js';

/** Our own cloud service (spec 0.11.0): the daily anonymous ping and the feedback messages go here, nowhere else. */
export const CLOUD_URL = 'https://bewerbungspilot.robikovach.workers.dev';

/**
 * `BP_CLOUD_URL` is for tests only: honoured just on a throw-away data folder with fake mail (like the dev update
 * source). Set but not allowed means ignored, with one warning when a logger is given.
 */
export function cloudUrl(env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = process.argv, logger?: Logger): string {
  const override = env.BP_CLOUD_URL;
  if (override) {
    if (devUpdateSourceAllowed(env, argv)) return override.replace(/\/+$/, '');
    logger?.warn('test_url_ignored', { name: 'BP_CLOUD_URL', reason: 'needs BP_DATA_DIR and fake mail' });
  }
  return CLOUD_URL;
}

/** `BP_UPDATE_URL` (the version.json address) under the same rule as `cloudUrl`. */
export function versionJsonUrl(defaultUrl: string, env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = process.argv, logger?: Logger): string {
  const override = env.BP_UPDATE_URL;
  if (override) {
    if (devUpdateSourceAllowed(env, argv)) return override;
    logger?.warn('test_url_ignored', { name: 'BP_UPDATE_URL', reason: 'needs BP_DATA_DIR and fake mail' });
  }
  return defaultUrl;
}
