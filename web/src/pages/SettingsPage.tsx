import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AiHelperCards } from '../ai/AiHelperCards';
import { api } from '../api';
import { AI_SETTINGS_HASH, ErrorBanner } from '../components/ErrorBanner';
import { InfoTip } from '../components/InfoTip';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { MailSettingsBlock } from '../mail/MailSettingsBlock';
import { useSettings } from '../settings';
import type { Language } from '../types';

type TestState =
  | { kind: 'idle' }
  | { kind: 'running'; controller: AbortController }
  | { kind: 'ok'; greeting: string }
  | { kind: 'failed'; error: unknown };

export function SettingsPage({ onQuit }: { onQuit: () => void }) {
  const { t, i18n } = useTranslation();
  const { settings, update } = useSettings();
  const chosen = settings.llm.provider !== null;
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [error, setError] = useState<unknown>(null);
  // The chosen helper's card already shows "Open sign-in window" — then the general button below is hidden.
  const [cardOffersLogin, setCardOffersLogin] = useState(false);
  const aiBlock = useRef<HTMLDivElement>(null);

  // Arrived from an error's "Open Settings → AI helper" link: bring the AI block into view.
  useEffect(() => {
    if (window.location.hash === AI_SETTINGS_HASH) aiBlock.current?.scrollIntoView?.({ block: 'start' });
  }, []);

  const runTest = async () => {
    const controller = new AbortController();
    setTest({ kind: 'running', controller });
    try {
      const r = await api.testLlm(i18n.language as Language, controller.signal);
      setTest({ kind: 'ok', greeting: r.greeting });
    } catch (err) {
      setTest((err as Error).name === 'AbortError' ? { kind: 'idle' } : { kind: 'failed', error: err });
    }
  };

  const guarded = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (err) { setError(err); }
  };

  return (
    <section>
      <h1>{t('settings.title')}</h1>

      <div className="card settings-section">
        <h2>{t('settings.languageTitle')}<InfoTip textKey="info.languageSwitcher" /></h2>
        <LanguageSwitcher />
      </div>

      <div className="card settings-section" id="ai-helper" ref={aiBlock}>
        <h2>{t('onboarding.ai.title')}<InfoTip textKey="info.claudeTest" /></h2>
        <AiHelperCards onLoginOffered={setCardOffersLogin} />
        {!chosen ? <p className="muted">{t('onboarding.ai.noneChosen')}</p> : null}
        {test.kind === 'running' ? (
          <div className="btn-row">
            <span className="muted">{t('settings.claudeRunning')}</span>
            <button type="button" className="btn ghost" onClick={() => test.controller.abort()}>{t('common.cancel')}</button>
          </div>
        ) : (
          <div className="btn-row">
            <button type="button" className="btn" disabled={!chosen} onClick={() => void runTest()}>{t('settings.claudeTest')}</button>
            {chosen && !cardOffersLogin ? (
              <button type="button" className="btn ghost" onClick={() => void guarded(() => api.openLogin())}>{t('onboarding.ai.openLogin')}</button>
            ) : null}
          </div>
        )}
        {test.kind === 'ok' ? <p className="ok">{t('settings.claudeResult', { greeting: test.greeting })}</p> : null}
        {test.kind === 'failed' ? <ErrorBanner error={test.error} /> : null}
      </div>

      <div className="card settings-section">
        <h2>{t('settings.mailTitle')}</h2>
        <MailSettingsBlock />
      </div>

      <div className="card settings-section">
        <h2>{t('settings.introTitle')}<InfoTip textKey="info.restartIntro" /></h2>
        <button type="button" className="btn ghost" onClick={() => void guarded(() => update({ onboarding: { completed: false, currentStep: 'welcome' } }))}>
          {t('settings.introRestart')}
        </button>
      </div>

      <div className="card settings-section">
        <h2>{t('settings.quitTitle')}<InfoTip textKey="info.quit" /></h2>
        <button type="button" className="btn ghost" onClick={onQuit}>{t('settings.quitButton')}</button>
      </div>

      {error ? <ErrorBanner error={error} /> : null}
    </section>
  );
}
