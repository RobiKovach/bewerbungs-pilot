import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, muteNoSession } from '../api';

const PROGRESS_MS = 1000;
const HEALTH_MS = 2000;
const WAIT_MS = 3 * 60_000;

type Phase =
  | { kind: 'step'; step: 'downloading' | 'checking' | 'installing' }
  | { kind: 'restarting' }
  | { kind: 'done' }
  | { kind: 'notFinished' }
  | { kind: 'timeout' }
  | { kind: 'failed'; reason: string };

const sleep = (ms: number) => new Promise<void>((r) => { window.setTimeout(r, ms); });

/**
 * Shown over the whole page from the moment the server accepted "Update now" (spec 0.11.0): the steps, then — when the
 * server goes away to be replaced — a wait for the new one on /api/health (public, no launch key; the old key is
 * useless for the new server). It never calls a key-protected route after the server vanished.
 */
export function UpdateProgress({ target, onClose }: { target: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: 'step', step: 'downloading' });

  useEffect(() => {
    let alive = true;
    const run = async () => {
      let down: boolean;
      // 1. The server reports its steps until it quits to let the installer work.
      for (;;) {
        await sleep(PROGRESS_MS);
        if (!alive) return;
        try {
          const p = await api.updateProgress();
          if (!alive) return;
          if (p.state === 'failed') {
            muteNoSession(false);
            setPhase({ kind: 'failed', reason: p.error ?? 'unknown' });
            return;
          }
          if (p.state === 'idle') continue;
          setPhase({ kind: 'step', step: p.state === 'downloading' ? 'downloading' : p.state === 'installing' ? 'installing' : 'checking' });
        } catch (err) {
          if (!alive) return;
          // Unreachable = gone; NO_SESSION = the new server (new key) already answers.
          down = err instanceof ApiError && (err.code === 'SERVER_UNREACHABLE' || err.code === 'NO_SESSION');
          break;
        }
      }
      // 2. The server is gone (or answered something else): wait for the app to come back.
      setPhase({ kind: 'restarting' });
      const deadline = Date.now() + WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(HEALTH_MS);
        if (!alive) return;
        try {
          const h = await api.health();
          if (!alive) return;
          // The old server may still be shutting down: only an answer after we saw it gone counts.
          if (!down) continue;
          // Stays muted: the new server refuses this tab's old key, which must not replace the text below.
          setPhase({ kind: h.version === target ? 'done' : 'notFinished' });
          return;
        } catch {
          down = true;
        }
      }
      if (alive) setPhase({ kind: 'timeout' });
    };
    void run();
    return () => { alive = false; };
  }, [target]);

  const failed = phase.kind === 'failed';
  const reasonKey = failed ? `errors.reasons.${phase.reason}` : '';
  const text = (() => {
    switch (phase.kind) {
      case 'step': return t(`updates.step.${phase.step}`);
      case 'restarting': return t('updates.step.restarting');
      case 'done': return t('updates.done');
      case 'notFinished': return t('updates.notFinished');
      case 'timeout': return t('updates.timeout');
      case 'failed': return t('updates.failed', { reason: i18n.exists(reasonKey) ? t(reasonKey) : t('updates.failedUnknown') });
    }
  })();
  const ended = phase.kind === 'failed';

  return (
    <div className="update-overlay" role="status" aria-live="polite">
      <div className="card">
        <h1>{t('updates.available', { version: target })}</h1>
        <p className={ended ? 'error-banner__reason' : undefined}>{text}</p>
        {ended ? <button type="button" className="btn" onClick={onClose}>{t('updates.close')}</button> : null}
      </div>
    </div>
  );
}
