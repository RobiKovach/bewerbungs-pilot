import { CorruptJsonError, readJson, writeJsonAtomic } from '../data/atomic.js';
import type { Logger } from '../log.js';

const FIRST_PING_MS = 60_000;
const INTERVAL_MS = 24 * 3600_000;
/** While the ping is switched off nothing is sent; we only look again whether it was switched on. */
const OFF_RECHECK_MS = 3600_000;
const TIMEOUT_MS = 10_000;

/** Test, demo and fake modes never count as a user (spec 0.11.0). */
export function shouldPing(m: { demo: boolean; fakeLlm: boolean; fakeMail: boolean }): boolean {
  return !m.demo && !m.fakeLlm && !m.fakeMail;
}

export interface UsagePingerDeps {
  url: string;
  /** `<data root>/usage-state.json` { lastPingAt }: restarts never mean more pings than one a day. */
  stateFile: string;
  version: string;
  installId: () => string;
  enabled: () => boolean;
  fetch?: typeof fetch;
  now?: () => number;
  logger: Logger;
}

/**
 * Once a day tells our cloud service "this install, this version is alive": exactly { installId, version },
 * nothing else. Every failure is one log line; the next try is tomorrow.
 */
export class UsagePinger {
  private lastPingAt: number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: AbortController | null = null;
  private running = false;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly d: UsagePingerDeps) {
    this.fetchFn = d.fetch ?? fetch;
    this.now = d.now ?? Date.now;
    // A clock that went back (or a hand-edited file) must not push the next ping out of range or make it instant.
    const saved = this.readState();
    this.lastPingAt = saved > this.now() ? 0 : saved;
  }

  start(): void {
    this.stop();
    this.running = true;
    this.schedule(Math.max(FIRST_PING_MS, this.lastPingAt + INTERVAL_MS - this.now()));
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.inFlight?.abort();
    this.inFlight = null;
  }

  async pingNow(): Promise<void> {
    if (!this.d.enabled()) return;
    const ctrl = new AbortController();
    this.inFlight = ctrl;
    let timedOut = false;
    const cut = setTimeout(() => { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
    try {
      const res = await this.fetchFn(`${this.d.url}/v1/ping`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installId: this.d.installId(), version: this.d.version }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (ctrl.signal.aborted && !timedOut) return; // stopped (shutdown): not a failure
      this.d.logger.warn('usage_ping_failed', { reason: timedOut ? 'timeout' : err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown' });
    } finally {
      clearTimeout(cut);
      if (this.inFlight === ctrl) this.inFlight = null;
    }
    // A failure counts too: the next try is tomorrow, not on every restart.
    this.lastPingAt = this.now();
    try {
      writeJsonAtomic(this.d.stateFile, { lastPingAt: this.lastPingAt });
    } catch (err) {
      this.d.logger.warn('usage_state_write_failed', { message: String(err) });
    }
  }

  private schedule(ms: number): void {
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (!this.d.enabled()) { this.schedule(OFF_RECHECK_MS); return; }
    const due = this.lastPingAt + INTERVAL_MS - this.now();
    if (due > 0 && due <= INTERVAL_MS) { this.schedule(due); return; }
    await this.pingNow();
    if (this.running) this.schedule(INTERVAL_MS);
  }

  private readState(): number {
    let raw: unknown = null;
    try { raw = readJson<unknown>(this.d.stateFile); } catch (err) {
      if (!(err instanceof CorruptJsonError)) this.d.logger.warn('usage_state_read_failed', { message: String(err) });
    }
    const v = raw && typeof raw === 'object' ? (raw as { lastPingAt?: unknown }).lastPingAt : undefined;
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
}
