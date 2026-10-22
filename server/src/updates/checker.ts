import type { Language } from '@bp/shared';
import { CorruptJsonError, readJson, writeJsonAtomic } from '../data/atomic.js';
import type { Logger } from '../log.js';
import { isNewer, parseVersionFile, type VersionFile } from './version-file.js';

const FIRST_CHECK_MS = 60_000;
const INTERVAL_MS = 24 * 3600_000;
/** While the check is switched off nothing is requested; we only look again whether it was switched on. */
const OFF_RECHECK_MS = 3600_000;
const TIMEOUT_MS = 10_000;
const MAX_BODY = 64 * 1024;

export interface AvailableUpdate { version: string; url: string; notes: Partial<Record<Language, string>> }

interface State { lastCheckedAt: number; latest: VersionFile | null }

export interface UpdateCheckerDeps {
  url: string;
  /** `<data root>/update-state.json`: the last check survives restarts, so restarts never mean more requests. */
  stateFile: string;
  currentVersion: string;
  enabled: () => boolean;
  fetch?: typeof fetch;
  now?: () => number;
  logger: Logger;
}

/**
 * Once a day asks our version.json whether there is a newer version (spec 0.9.0, 3.3). A plain GET without
 * anything about the person; every failure is one log line and the previous answer stays.
 */
export class UpdateChecker {
  private state: State;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: AbortController | null = null;
  private running = false;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly d: UpdateCheckerDeps) {
    this.fetchFn = d.fetch ?? fetch;
    this.now = d.now ?? Date.now;
    this.state = this.readState();
  }

  start(): void {
    this.stop();
    this.running = true;
    const due = this.state.lastCheckedAt + INTERVAL_MS - this.now();
    this.schedule(Math.max(FIRST_CHECK_MS, due));
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.inFlight?.abort();
    this.inFlight = null;
  }

  /** The newest published version when it is newer than this one, otherwise null. */
  available(): AvailableUpdate | null {
    const latest = this.state.latest;
    if (!latest || !isNewer(latest.latest, this.d.currentVersion)) return null;
    return { version: latest.latest, url: latest.url, notes: latest.notes };
  }

  async checkNow(): Promise<void> {
    const ctrl = new AbortController();
    this.inFlight = ctrl;
    let latest: VersionFile | null = null;
    try {
      // No query, no cookies, no headers about the person: the same request from everyone.
      const res = await this.fetchFn(this.d.url, { method: 'GET', signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(TIMEOUT_MS)]) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      latest = parseVersionFile(JSON.parse(await readLimited(res)));
      if (latest === null) throw new Error('invalid version file');
    } catch (err) {
      if (ctrl.signal.aborted) return; // stopped (shutdown): not a failure
      this.d.logger.warn('update_check_failed', { reason: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown' });
    } finally {
      if (this.inFlight === ctrl) this.inFlight = null;
    }
    // A failure counts as a check too: the next try is tomorrow, not on every restart.
    this.state = { lastCheckedAt: this.now(), latest: latest ?? this.state.latest };
    try {
      writeJsonAtomic(this.d.stateFile, this.state);
    } catch (err) {
      this.d.logger.warn('update_state_write_failed', { message: String(err) });
    }
  }

  private schedule(ms: number): void {
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (!this.d.enabled()) { this.schedule(OFF_RECHECK_MS); return; }
    const due = this.state.lastCheckedAt + INTERVAL_MS - this.now();
    if (due > 0 && due <= INTERVAL_MS) { this.schedule(due); return; }
    await this.checkNow();
    if (this.running) this.schedule(INTERVAL_MS);
  }

  private readState(): State {
    let raw: unknown = null;
    try { raw = readJson<unknown>(this.d.stateFile); } catch (err) {
      if (!(err instanceof CorruptJsonError)) this.d.logger.warn('update_state_read_failed', { message: String(err) });
    }
    const r = (raw && typeof raw === 'object' ? raw : {}) as { lastCheckedAt?: unknown; latest?: unknown };
    const last = typeof r.lastCheckedAt === 'number' && Number.isFinite(r.lastCheckedAt) ? r.lastCheckedAt : 0;
    return { lastCheckedAt: last, latest: parseVersionFile(r.latest) };
  }
}

/** The body as text, but never more than 64 KB (a huge answer is a broken site, not a version file). */
async function readLimited(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      throw new Error('response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
