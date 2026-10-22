import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { useSettings } from '../settings';
import type { Availability, InstallStatus, ProviderId } from '../types';

// Pinned in task 1 (OpenAI's "Data controls" help page).
export const CHATGPT_PRIVACY_URL = 'https://help.openai.com/en/articles/7730893-data-controls-in-chatgpt';
const IDS: ProviderId[] = ['claude', 'chatgpt'];
const POLL_MS = 1500;
type Check = { kind: 'checking' } | { kind: 'done'; a: Availability } | { kind: 'failed' };

/** Two cards (Claude, ChatGPT): state, "Choose", then Install → Open sign-in window → Check again.
 *  The choice is saved to settings.llm.provider only once that helper's check is ok. */
export function AiHelperCards({ onReady, onLoginOffered, pollMs = POLL_MS }: {
  onReady?: (id: ProviderId) => void;
  /** Tells the parent whether the saved helper's card currently offers "Open sign-in window" (Settings hides its own). */
  onLoginOffered?: (offered: boolean) => void;
  pollMs?: number;
}) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const [checks, setChecks] = useState<Record<ProviderId, Check>>({ claude: { kind: 'checking' }, chatgpt: { kind: 'checking' } });
  const [open, setOpen] = useState<ProviderId | null>(settings.llm.provider);
  const [install, setInstall] = useState<InstallStatus | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Async checks finish after later renders: read the current values through refs, not stale closures.
  const openRef = useRef(open);
  const latest = useRef({ provider: settings.llm.provider, update, onReady });
  useEffect(() => { latest.current = { provider: settings.llm.provider, update, onReady }; });

  const select = useCallback(async (id: ProviderId) => {
    if (latest.current.provider !== id) await latest.current.update({ llm: { provider: id } });
    latest.current.onReady?.(id);
  }, []);

  const check = useCallback(async (id: ProviderId, refresh: boolean) => {
    setChecks((c) => ({ ...c, [id]: { kind: 'checking' } }));
    let ok: boolean;
    try {
      const r = await api.checkLlm(id, refresh);
      setChecks((c) => ({ ...c, [id]: { kind: 'done', a: r.availability } }));
      ok = r.availability.ok;
    } catch (err) {
      setChecks((c) => ({ ...c, [id]: { kind: 'failed' } }));
      setError(err);
      return;
    }
    // The helper did answer: a failed save of the choice is shown as that error, not as "did not answer".
    if (ok && openRef.current === id) {
      try { await select(id); } catch (err) { setError(err); }
    }
  }, [select]);

  useEffect(() => { for (const id of IDS) void check(id, false); }, [check]);

  // An install started earlier (another page, a reload) is still running: show it and let the polling below take over.
  useEffect(() => {
    let stopped = false;
    void api.installStatus().then((s) => { if (!stopped && s.state === 'running') setInstall(s); }).catch(() => undefined);
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    if (install?.state !== 'running') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    // The next poll is planned only after the answer: a slow answer never overlaps the next request.
    const poll = async () => {
      try {
        const s = await api.installStatus();
        if (stopped) return;
        setInstall(s);
        if (s.state === 'done' && s.provider) void check(s.provider, true);
        if (s.state === 'running') timer = setTimeout(() => void poll(), pollMs);
      } catch (err) {
        if (stopped) return;
        setError(err);
        timer = setTimeout(() => void poll(), pollMs);
      }
    };
    timer = setTimeout(() => void poll(), pollMs);
    return () => { stopped = true; clearTimeout(timer); };
  }, [install?.state, check, pollMs]);

  const saved = settings.llm.provider;
  const savedCheck = saved ? checks[saved] : null;
  const loginOffered = saved !== null && open === saved && savedCheck?.kind === 'done' && savedCheck.a.reason === 'not-logged-in';
  useEffect(() => { onLoginOffered?.(loginOffered); }, [loginOffered, onLoginOffered]);

  const guarded = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (err) { setError(err); }
  };

  const choose = (id: ProviderId, a: Availability | null) => {
    setError(null);
    openRef.current = id;
    setOpen(id);
    if (a?.ok) void guarded(() => select(id));
  };

  return (
    <>
      <div className="ai-cards">
        {IDS.map((id) => {
          const c = checks[id];
          const a = c.kind === 'done' ? c.a : null;
          const name = t(`onboarding.ai.${id}.name`);
          const chosen = settings.llm.provider === id;
          return (
            <div key={id} className={`card ai-card${open === id ? ' open' : ''}`}>
              <h3>{name}{chosen ? <span className="badge ok-badge">{t('onboarding.ai.chosen')}</span> : null}</h3>
              <p>{t(`onboarding.ai.${id}.price`)}</p>
              <p className="muted">{t(`onboarding.ai.${id}.limit`)} {t(`onboarding.ai.${id}.cost`)}</p>
              {id === 'chatgpt' ? (
                <p className="muted">
                  ⚠ {t('onboarding.ai.chatgpt.privacy')}{' '}
                  <a href={CHATGPT_PRIVACY_URL} target="_blank" rel="noreferrer">{t('onboarding.ai.chatgpt.privacyLink')}</a>
                </p>
              ) : null}
              <p className={a?.ok ? 'ok' : 'muted'}>
                {c.kind === 'checking' ? t('onboarding.ai.checking')
                  : a?.ok ? `✓ ${t('onboarding.ai.ready', { ai: name })}`
                  : a?.reason === 'not-installed' && install?.provider === id && install.state === 'done' ? t('onboarding.ai.installedNotFound', { ai: name })
                  : a?.reason === 'not-installed' ? t('onboarding.ai.notInstalled')
                  : a?.reason === 'not-logged-in' ? t('onboarding.ai.notLoggedIn')
                  : t('onboarding.ai.error', { ai: name })}
              </p>
              {open !== id ? (
                <button type="button" className="btn" onClick={() => choose(id, a)}>{t('onboarding.ai.choose')}</button>
              ) : (
                <div className="btn-row">
                  {a?.reason === 'not-installed' ? (
                    <button type="button" className="btn" disabled={install?.state === 'running'}
                      onClick={() => void guarded(async () => setInstall(await api.installLlm(id)))}>
                      {t('onboarding.ai.install')}
                    </button>
                  ) : null}
                  {a?.reason === 'not-logged-in' ? (
                    <button type="button" className="btn" onClick={() => void guarded(() => api.openLogin(id))}>{t('onboarding.ai.openLogin')}</button>
                  ) : null}
                  <button type="button" className="btn ghost" disabled={c.kind === 'checking'}
                    onClick={() => { setError(null); void check(id, true); }}>
                    {t('onboarding.ai.checkAgain')}
                  </button>
                </div>
              )}
              {install?.provider === id && install.state === 'running' ? <p className="muted">{t('onboarding.ai.installing')}</p> : null}
              {install?.provider === id && install.state === 'failed' ? (
                <div className="error-banner">
                  <p><strong>{t('onboarding.ai.installFailed')}</strong></p>
                  {install.detail ? (
                    <p className="error-banner__technical-label muted">{t('onboarding.ai.supportLine')} <code>{install.detail}</code></p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? <ErrorBanner error={error} /> : null}
    </>
  );
}
