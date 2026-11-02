/** Our own cloud service (spec 0.11.0): the daily anonymous ping and the feedback messages go here, nowhere else. */
export const CLOUD_URL = 'https://bewerbungspilot.robikovach.workers.dev';

/** `BP_CLOUD_URL` is for tests only (like BP_UPDATE_URL). */
export const cloudUrl = (env: NodeJS.ProcessEnv = process.env): string => (env.BP_CLOUD_URL || CLOUD_URL).replace(/\/+$/, '');
