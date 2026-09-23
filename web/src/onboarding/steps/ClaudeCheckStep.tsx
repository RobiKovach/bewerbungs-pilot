import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { ErrorBanner } from '../../components/ErrorBanner';
import type { Availability } from '../../types';
import type { StepProps } from '../steps';

type State = { kind: 'checking' } | { kind: 'done'; availability: Availability } | { kind: 'failed'; error: unknown };

export function ClaudeCheckStep({ onNext }: StepProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'checking' });

  const check = useCallback(async (refresh: boolean) => {
    setState({ kind: 'checking' });
    try {
      const r = await api.checkLlm(refresh);
      setState({ kind: 'done', availability: r.availability });
    } catch (error) {
      setState({ kind: 'failed', error });
    }
  }, []);

  useEffect(() => { void check(false); }, [check]);

  const openLogin = async () => {
    try { await api.openLogin(); } catch (error) { setState({ kind: 'failed', error }); }
  };

  const ready = state.kind === 'done' && state.availability.ok;
  const reason = state.kind === 'done' && !state.availability.ok ? state.availability.reason ?? 'error' : null;

  return (
    <>
      <p>{t('onboarding.claude.intro')}</p>
      {state.kind === 'checking' ? <p className="muted">{t('onboarding.claude.checking')}</p> : null}
      {ready ? <p className="ok">✓ <span>{t('onboarding.claude.ok')}</span></p> : null}
      {reason === 'not-installed' || reason === 'not-logged-in' ? (
        <div className="card">
          <h2>{t(`onboarding.claude.${reason === 'not-installed' ? 'notInstalled' : 'notLoggedIn'}.title`)}</h2>
          <ol className="steps-list">
            {(['step1', 'step2', 'step3'] as const).map((s) => (
              <li key={s}>{t(`onboarding.claude.${reason === 'not-installed' ? 'notInstalled' : 'notLoggedIn'}.${s}`)}</li>
            ))}
          </ol>
          {reason === 'not-logged-in' ? (
            <button type="button" className="btn" onClick={() => void openLogin()}>{t('onboarding.claude.openLogin')}</button>
          ) : null}
        </div>
      ) : null}
      {reason === 'error' ? (
        <div className="card">
          <h2>{t('onboarding.claude.error.title')}</h2>
          <p>{t('onboarding.claude.error.hint')}</p>
        </div>
      ) : null}
      {state.kind === 'failed' ? <ErrorBanner error={state.error} /> : null}
      <div className="btn-row">
        {!ready && state.kind !== 'checking' ? (
          <button type="button" className="btn ghost" onClick={() => void check(true)}>{t('common.retry')}</button>
        ) : null}
        <button type="button" className="btn" disabled={!ready} onClick={onNext}>{t('common.next')}</button>
        {!ready && state.kind !== 'checking' ? (
          <button type="button" className="btn ghost" onClick={onNext}>{t('common.continueAnyway')}</button>
        ) : null}
      </div>
    </>
  );
}
